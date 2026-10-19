import { type AgentState } from '@lobechat/agent-runtime';
import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { type RuntimeExecutorContext } from '../context';
import { buildServerAgentMemberRunner, resolveGroupMemberId } from '../executorHelpers';

describe('resolveGroupMemberId', () => {
  const agentMap = {
    agt_member: { name: 'Meituan Assistant' },
    agt_supervisor: { name: 'Supervisor' },
  };

  it('keeps a persisted agent id unchanged', () => {
    expect(resolveGroupMemberId('agt_member', agentMap)).toBe('agt_member');
  });

  it('resolves an exact member display name to its persisted agent id', () => {
    expect(resolveGroupMemberId('Meituan Assistant', agentMap)).toBe('agt_member');
  });

  it('does not guess when a display name is ambiguous', () => {
    expect(
      resolveGroupMemberId('Assistant', {
        agt_first: { name: 'Assistant' },
        agt_second: { name: 'Assistant' },
      }),
    ).toBe('Assistant');
  });
});

describe('buildServerAgentMemberRunner barrier records', () => {
  const tool = {
    apiName: 'executeAgentTasks',
    arguments: '{}',
    id: 'call-tasks-1',
    identifier: 'lobe-group-management',
    type: 'builtin',
  } as ChatToolPayload;

  const state = {
    operationId: 'operation-1',
    origin: {
      agentId: 'supervisor-1',
      groupId: 'group-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    },
  } as AgentState;

  const createContext = () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'group-tool-1' })
      .mockResolvedValueOnce({ id: 'anchor-1' })
      .mockResolvedValueOnce({ id: 'anchor-2' });
    const execGroupMember = vi.fn().mockResolvedValue({ started: true });
    const context = {
      execGroupMember,
      messageModel: { create, deleteMessage: vi.fn(), updateToolMessage: vi.fn() },
      operationId: 'operation-1',
      topicId: 'topic-1',
    } as unknown as RuntimeExecutorContext;

    return { context, create, execGroupMember };
  };

  it('persists explicit internal metadata on each multi-member barrier anchor', async () => {
    const { context, create, execGroupMember } = createContext();
    const runner = buildServerAgentMemberRunner(context, state, tool, 'supervisor-message-1');

    await runner!.run({
      members: [
        { agentId: 'member-1', instruction: 'one' },
        { agentId: 'member-2', instruction: 'two' },
      ],
      mode: 'isolated',
      onComplete: 'resume',
    });

    expect(create).toHaveBeenCalledTimes(3);
    for (const call of create.mock.calls.slice(1)) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          metadata: {
            runtimeRecord: { kind: 'group-member-barrier', visibility: 'internal' },
          },
          parentId: 'group-tool-1',
          role: 'tool',
        }),
      );
    }
    expect(execGroupMember.mock.calls.map(([params]) => params.anchorMessageId)).toEqual([
      'anchor-1',
      'anchor-2',
    ]);
  });

  it('keeps a single-member execution on the group tool without an internal anchor row', async () => {
    const { context, create, execGroupMember } = createContext();
    const runner = buildServerAgentMemberRunner(context, state, tool, 'supervisor-message-1');

    await runner!.run({
      members: [{ agentId: 'member-1', instruction: 'one' }],
      mode: 'isolated',
      onComplete: 'resume',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].metadata).toBeUndefined();
    expect(execGroupMember).toHaveBeenCalledWith(
      expect.objectContaining({ anchorMessageId: 'group-tool-1', mode: 'isolated' }),
    );
  });
});
