import { isRecord } from '@lobechat/utils/object';

import type { AcpAgentSessionOptions } from './acpAgentSession';
import {
  ACP_PROTOCOL_VERSION,
  AcpAgentSession,
  selectAcpPermissionOption,
} from './acpAgentSession';
import type { AcpRpcMessage } from './acpStdioClient';
import { AcpServerRequestError } from './acpStdioClient';
import type { AgentPromptInput } from './input';

const TRANSPORT = 'acp-stdio' as const;

interface DshAcpInitializeResult {
  agentCapabilities?: {
    mcpCapabilities?: { http?: boolean };
    sessionCapabilities?: { close?: unknown; list?: unknown; resume?: unknown };
  };
  protocolVersion?: number | string;
}

interface DshAcpSessionResult {
  sessionId?: string;
}

export interface DshAcpSessionOptions extends AcpAgentSessionOptions {
  prompt: AgentPromptInput;
}

export const buildDshAcpArgs = (extraArgs: string[] = []): string[] => [
  '--profile',
  'acp',
  ...extraArgs,
];

const toPromptBlocks = (prompt: AgentPromptInput) =>
  (typeof prompt === 'string' ? [{ text: prompt, type: 'text' as const }] : prompt).map((block) => {
    if (block.type !== 'text') throw new Error('DeepSeek Harness ACP does not support image input');
    return { text: block.text, type: 'text' as const };
  });

/** DeepSeek Harness' official ACP profile, including persistent session resume and cancellation. */
export class DshAcpSession extends AcpAgentSession<DshAcpInitializeResult, DshAcpSessionOptions> {
  private acceptUpdates = false;

  constructor(options: DshAcpSessionOptions) {
    super(options, {
      args: buildDshAcpArgs(options.args),
      pipeline: { agentType: 'dsh', cwd: options.cwd },
      processLabel: 'DeepSeek Harness ACP',
      transport: TRANSPORT,
    });
  }

  get nativeSessionId(): string | undefined {
    return this.acpSessionId;
  }

  protected buildInitializeParams(): unknown {
    return {
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: {
        name: 'fab',
        title: '驰拓 AI 助手',
        version: this.options.clientVersion,
      },
      protocolVersion: ACP_PROTOCOL_VERSION,
    };
  }

  protected validateInitialized(initialized: DshAcpInitializeResult): void {
    if (
      initialized.protocolVersion !== ACP_PROTOCOL_VERSION &&
      initialized.protocolVersion !== String(ACP_PROTOCOL_VERSION)
    ) {
      throw new Error(
        `DeepSeek Harness ACP returned unsupported protocol version: ${String(initialized.protocolVersion)}`,
      );
    }
    if (
      this.options.resumeSessionId &&
      initialized.agentCapabilities?.sessionCapabilities?.resume === undefined
    ) {
      throw new Error('DeepSeek Harness ACP does not support resuming sessions');
    }
  }

  protected async establishSession(_initialized: DshAcpInitializeResult): Promise<string> {
    const resumed = Boolean(this.options.resumeSessionId);
    const result = await this.client.request<DshAcpSessionResult>(
      resumed ? 'session/resume' : 'session/new',
      {
        cwd: this.options.cwd,
        mcpServers: [],
        ...(resumed ? { sessionId: this.options.resumeSessionId } : {}),
      },
    );
    const sessionId = result.sessionId ?? this.options.resumeSessionId;
    if (!sessionId) throw new Error('DeepSeek Harness ACP returned no session id');
    this.options.onSessionId(sessionId);
    await this.pushToPipeline({ sessionId, type: 'dsh_session' });
    return sessionId;
  }

  protected onBeforePrompt(): void {
    this.acceptUpdates = true;
  }

  protected buildPromptParams(sessionId: string): unknown {
    return { prompt: toPromptBlocks(this.options.prompt), sessionId };
  }

  protected override async settlePrompt(result: unknown): Promise<void> {
    await this.client.drain();
    await this.pushToPipeline({
      stopReason: isRecord(result) ? result.stopReason : undefined,
      type: 'dsh_prompt_completed',
    });
  }

  protected async onRunFailure(error: Error): Promise<void> {
    await this.pushToPipeline({ message: error.message, type: 'dsh_error' });
    await this.emitEvents(await this.pipeline.flush());
  }

  protected async handleAgentMessage(message: AcpRpcMessage): Promise<void> {
    if (!this.acceptUpdates || message.method !== 'session/update') return;
    const params = isRecord(message.params) ? message.params : undefined;
    if (!isRecord(params?.update)) return;
    await this.pushToPipeline(params.update);
  }

  protected async handleServerRequest(message: AcpRpcMessage): Promise<unknown> {
    if (message.method !== 'session/request_permission') {
      throw new AcpServerRequestError(-32_601, `Unsupported ACP client request: ${message.method}`);
    }
    const optionId = selectAcpPermissionOption(message.params, [
      (option) => option.kind === 'allow_once',
      (option) => option.kind === 'allow',
    ]);
    return {
      outcome: optionId ? { optionId, outcome: 'selected' } : { outcome: 'cancelled' },
    };
  }
}
