import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { isRecord } from '@lobechat/utils/object';

import { ACP_PROTOCOL_VERSION, selectAcpPermissionOption } from './acpAgentSession';
import type { AcpRpcMessage, AcpStdioClientOptions } from './acpStdioClient';
import { AcpServerRequestError, AcpStdioClient } from './acpStdioClient';
import { AgentStreamPipeline } from './agentStreamPipeline';
import { buildDshAcpArgs } from './dshAcpSession';

interface DshInitializeResult {
  agentCapabilities?: {
    sessionCapabilities?: { close?: unknown; list?: unknown; resume?: unknown };
  };
  protocolVersion?: number | string;
}

interface DshSessionResult {
  sessionId?: string;
}

interface ActiveTurn {
  onEvents: (events: AgentStreamEvent[]) => Promise<void> | void;
  operationId: string;
  pipeline: AgentStreamPipeline;
}

export interface PersistentDshAcpClientOptions {
  args?: string[];
  clientVersion: string;
  commandPath: string;
  cwd: string;
  detached?: boolean;
  env: NodeJS.ProcessEnv;
  onRawMessage?: (line: string) => Promise<void> | void;
  onStderr?: (data: string) => Promise<void> | void;
  requestTimeoutMs?: number;
}

export interface PersistentDshTurnOptions {
  model?: string;
  onEvents: (events: AgentStreamEvent[]) => Promise<void> | void;
  operationId: string;
  prompt: string;
  resumeSessionId?: string;
}

/**
 * One long-lived official DSH ACP process shared by concurrent Fab sessions.
 * ACP stdio never leaves the trusted worker boundary; callers receive only
 * normalized stream events and opaque native session ids.
 */
export class PersistentDshAcpClient {
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly client: AcpStdioClient;
  private initializePromise?: Promise<DshInitializeResult>;
  private readonly knownSessions = new Set<string>();

  constructor(private readonly options: PersistentDshAcpClientOptions) {
    const clientOptions: AcpStdioClientOptions = {
      args: buildDshAcpArgs(options.args),
      commandPath: options.commandPath,
      cwd: options.cwd,
      detached: options.detached,
      env: options.env,
      onMessage: (message) => this.handleAgentMessage(message),
      onRawMessage: options.onRawMessage ?? (() => undefined),
      onServerRequest: (message) => this.handleServerRequest(message),
      onStderr: options.onStderr ?? (() => undefined),
      processLabel: 'DeepSeek Harness ACP',
      requestTimeoutMs: options.requestTimeoutMs,
    };
    this.client = new AcpStdioClient(clientOptions);
  }

  get pid(): number | undefined {
    return this.client.pid;
  }

  async runTurn(options: PersistentDshTurnOptions): Promise<string> {
    const initialized = await this.initialize();
    const sessionId = await this.ensureSession(initialized, options.resumeSessionId);
    if (this.activeTurns.has(sessionId)) {
      throw new Error('DeepSeek Harness ACP session already has a running turn');
    }

    const pipeline = new AgentStreamPipeline({
      agentType: 'dsh',
      cwd: this.options.cwd,
      operationId: options.operationId,
    });
    const turn: ActiveTurn = {
      onEvents: options.onEvents,
      operationId: options.operationId,
      pipeline,
    };
    this.activeTurns.set(sessionId, turn);

    try {
      if (options.model) {
        await this.client.request('session/set_config_option', {
          configId: 'model',
          sessionId,
          value: options.model,
        });
      }
      await this.push(turn, { sessionId, type: 'dsh_session' });
      const result = await this.client.request<unknown>(
        'session/prompt',
        { prompt: [{ text: options.prompt, type: 'text' }], sessionId },
        false,
      );
      await this.client.drain();
      await this.push(turn, {
        stopReason: isRecord(result) ? result.stopReason : undefined,
        type: 'dsh_prompt_completed',
      });
      await this.emit(turn, await pipeline.flush());
      return sessionId;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await this.push(turn, { message: error.message, type: 'dsh_error' });
      await this.emit(turn, await pipeline.flush());
      throw error;
    } finally {
      this.activeTurns.delete(sessionId);
    }
  }

  interrupt(sessionId: string): void {
    if (!this.activeTurns.has(sessionId)) return;
    this.client.notify('session/cancel', { sessionId });
  }

  async closeSession(sessionId: string): Promise<void> {
    if (this.activeTurns.has(sessionId)) this.interrupt(sessionId);
    await this.client.request('session/close', { sessionId });
    this.knownSessions.delete(sessionId);
  }

  close(): void {
    this.activeTurns.clear();
    this.knownSessions.clear();
    this.client.close();
  }

  private initialize(): Promise<DshInitializeResult> {
    return (this.initializePromise ??= (async () => {
      await this.client.start();
      const initialized = await this.client.request<DshInitializeResult>('initialize', {
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: {
          name: 'fab',
          title: '驰拓 AI 助手',
          version: this.options.clientVersion,
        },
        protocolVersion: ACP_PROTOCOL_VERSION,
      });
      if (
        initialized.protocolVersion !== ACP_PROTOCOL_VERSION &&
        initialized.protocolVersion !== String(ACP_PROTOCOL_VERSION)
      ) {
        throw new Error(
          `DeepSeek Harness ACP returned unsupported protocol version: ${String(initialized.protocolVersion)}`,
        );
      }
      return initialized;
    })());
  }

  private async ensureSession(
    initialized: DshInitializeResult,
    resumeSessionId?: string,
  ): Promise<string> {
    if (resumeSessionId && this.knownSessions.has(resumeSessionId)) return resumeSessionId;
    if (
      resumeSessionId &&
      initialized.agentCapabilities?.sessionCapabilities?.resume === undefined
    ) {
      throw new Error('DeepSeek Harness ACP does not support resuming sessions');
    }

    const result = await this.client.request<DshSessionResult>(
      resumeSessionId ? 'session/resume' : 'session/new',
      {
        cwd: this.options.cwd,
        mcpServers: [],
        ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
      },
    );
    const sessionId = result.sessionId ?? resumeSessionId;
    if (!sessionId) throw new Error('DeepSeek Harness ACP returned no session id');
    this.knownSessions.add(sessionId);
    return sessionId;
  }

  private async handleAgentMessage(message: AcpRpcMessage): Promise<void> {
    if (message.method !== 'session/update') return;
    const params = isRecord(message.params) ? message.params : undefined;
    const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : undefined;
    if (!sessionId || !isRecord(params?.update)) return;
    const turn = this.activeTurns.get(sessionId);
    if (turn) await this.push(turn, params.update);
  }

  private handleServerRequest(message: AcpRpcMessage): unknown {
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

  private async push(turn: ActiveTurn, payload: unknown): Promise<void> {
    await this.emit(turn, await turn.pipeline.push(`${JSON.stringify(payload)}\n`));
  }

  private async emit(turn: ActiveTurn, events: AgentStreamEvent[]): Promise<void> {
    if (events.length > 0) await turn.onEvents(events);
  }
}
