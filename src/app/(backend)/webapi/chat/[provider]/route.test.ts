// @vitest-environment node
import {
  REQUEST_ASSISTANT_MESSAGE_ID_HEADER,
  REQUEST_OPERATION_ID_HEADER,
  REQUEST_TOPIC_ID_HEADER,
} from '@lobechat/const';
import { type LobeRuntimeAI } from '@lobechat/model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { POST } from './route';

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
  createTraceOptions: vi.fn().mockReturnValue({}),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

// 模拟请求和响应
let request: Request;
beforeEach(() => {
  request = new Request(new URL('https://test.com'), {
    method: 'POST',
    body: JSON.stringify({ model: 'test-model' }),
  });

  // Default: valid session
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'test-user-id' } as any,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST handler', () => {
  describe('init chat model', () => {
    it('should initialize ModelRuntime correctly with valid session', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });

      const mockChatResponse = new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockResolvedValue(mockChatResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      await POST(request as unknown as Request, { params: mockParams });

      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
        expect.anything(),
        'test-user-id',
        'test-provider',
        {
          model: 'test-model',
          modelType: 'chat',
          workspaceId: undefined,
        },
      );
    });

    it('should return Unauthorized error when no session exists', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      const mockParams = Promise.resolve({ provider: 'test-provider' });

      const response = await POST(request, { params: mockParams });

      expect(response.status).toBe(401);
    });
  });

  describe('chat', () => {
    it.each([undefined, 'topic-123'])(
      'should pass topic %s to chat runtime metadata',
      async (topicId) => {
        const mockParams = Promise.resolve({ provider: 'test-provider' });
        const mockChatPayload = { message: 'Hello, world!' };
        request = new Request(new URL('https://test.com'), {
          method: 'POST',
          headers: topicId ? { [REQUEST_TOPIC_ID_HEADER]: topicId } : {},
          body: JSON.stringify(mockChatPayload),
        });

        const mockChatResponse: any = { success: true, message: 'Reply from agent' };
        const mockRuntime: LobeRuntimeAI = {
          baseURL: 'abc',
          chat: vi.fn().mockResolvedValue(mockChatResponse),
        };

        vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

        const response = await POST(request as unknown as Request, { params: mockParams });

        expect(response).toEqual(mockChatResponse);
        expect(mockRuntime.chat).toHaveBeenCalledWith(
          mockChatPayload,
          expect.objectContaining({
            ...(topicId ? { metadata: { topicId } } : {}),
            user: 'test-user-id',
            signal: expect.anything(),
          }),
        );
      },
    );

    it('should pass billing metadata from request headers without mutating provider payload', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const mockChatPayload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
      };
      request = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify(mockChatPayload),
        headers: {
          [REQUEST_ASSISTANT_MESSAGE_ID_HEADER]: 'assistant-message-1',
          [REQUEST_OPERATION_ID_HEADER]: 'operation-1',
        },
      });

      const mockChatResponse: any = { success: true, message: 'Reply from agent' };
      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockResolvedValue(mockChatResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(request as unknown as Request, { params: mockParams });

      expect(response).toEqual(mockChatResponse);
      expect(mockRuntime.chat).toHaveBeenCalledWith(mockChatPayload, {
        metadata: {
          assistantMessageId: 'assistant-message-1',
          operationId: 'operation-1',
        },
        user: 'test-user-id',
        signal: expect.anything(),
      });
    });

    it('should return an error response when chat completion fails', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const mockChatPayload = { message: 'Hello, world!' };
      request = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify(mockChatPayload),
      });

      const mockErrorResponse = {
        errorType: ChatErrorType.InternalServerError,
        error: { errorMessage: 'Something went wrong', errorType: 500 },
        errorMessage: 'Something went wrong',
      };

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockRejectedValue(mockErrorResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(request, { params: mockParams });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        body: {
          errorMessage: 'Something went wrong',
          error: {
            errorMessage: 'Something went wrong',
            errorType: 500,
          },
          provider: 'test-provider',
        },
        errorType: 500,
      });
    });
  });
});
