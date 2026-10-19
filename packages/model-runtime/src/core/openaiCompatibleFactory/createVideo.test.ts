// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload } from '../../types/video';
import {
  createOpenAICompatibleVideo,
  pollOpenAICompatibleVideoStatus,
  queryOpenAICompatibleVideoStatus,
} from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

const mockOptions: CreateVideoOptions = {
  apiKey: 'test-api-key',
  baseURL: 'https://api.openai.com/v1',
  provider: 'openai',
};

const mockVllmOptions: CreateVideoOptions = {
  apiKey: 'test-api-key',
  baseURL: 'http://localhost:8000/v1',
  provider: 'vllm',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createOpenAICompatibleVideo', () => {
  describe('Success scenarios', () => {
    it('should create video task with basic prompt', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'video-task-123' }),
      });

      const payload: CreateVideoPayload = {
        model: 'sora-2.0',
        params: {
          prompt: 'A beautiful sunset over the ocean',
        },
      };

      const result = await createOpenAICompatibleVideo(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/videos', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sora-2.0',
          prompt: 'A beautiful sunset over the ocean',
        }),
      });

      expect(result).toEqual({ inferenceId: 'video-task-123' });
    });

    it('should include duration as string', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'video-task-456' }),
      });

      const payload: CreateVideoPayload = {
        model: 'sora-2.0',
        params: {
          prompt: 'A short clip',
          duration: 10,
        },
      };

      await createOpenAICompatibleVideo(payload, mockOptions);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.seconds).toBe('10');
    });

    it('should include size parameter', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'video-task-789' }),
      });

      const payload: CreateVideoPayload = {
        model: 'sora-2.0',
        params: {
          prompt: 'HD video',
          size: '1920x1080',
        },
      };

      await createOpenAICompatibleVideo(payload, mockOptions);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.size).toBe('1920x1080');
    });

    it('should include imageUrl as JSON input_reference object', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'video-task-img' }),
      });

      const payload: CreateVideoPayload = {
        model: 'sora-2.0',
        params: {
          prompt: 'Continue this scene',
          imageUrl: 'https://example.com/image.jpg',
        },
      };

      await createOpenAICompatibleVideo(payload, mockOptions);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.input_reference).toEqual({ image_url: 'https://example.com/image.jpg' });
    });

    it('should preserve string input_reference for non-OpenAI compatible providers', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'video-task-vllm-img' }),
      });

      const payload: CreateVideoPayload = {
        model: 'vllm-omni',
        params: {
          prompt: 'Continue this scene',
          imageUrl: 'https://example.com/image.jpg',
        },
      };

      await createOpenAICompatibleVideo(payload, mockVllmOptions);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.input_reference).toBe('https://example.com/image.jpg');
    });

    it('should fall back to v2 video generation API when v1 videos endpoint is missing', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'not found',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ task_id: 'v2-task-123' }),
        });

      const payload: CreateVideoPayload = {
        model: 'jimeng-video',
        params: {
          duration: 5,
          imageUrl: 'https://example.com/frame.jpg',
          prompt: 'Animate this scene',
          resolution: '1080p',
          size: '1920x1080',
        },
      };

      const result = await createOpenAICompatibleVideo(payload, mockVllmOptions);

      expect(result).toEqual({ inferenceId: 'v2-task-123' });
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:8000/v2/videos/generations',
        expect.any(Object),
      );
      expect(JSON.parse((global.fetch as any).mock.calls[1][1].body)).toEqual({
        duration: 5,
        image: 'https://example.com/frame.jpg',
        model: 'jimeng-video',
        prompt: 'Animate this scene',
        resolution: '1080p',
        size: '1920x1080',
      });
    });
  });

  describe('Error scenarios', () => {
    it('should throw on HTTP error', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid API key',
      });

      const payload: CreateVideoPayload = {
        model: 'sora-2.0',
        params: { prompt: 'Test' },
      };

      await expect(createOpenAICompatibleVideo(payload, mockOptions)).rejects.toThrow(
        'OpenAI-compatible video API error: 401 Invalid API key',
      );
    });

    it('should throw when response missing id', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const payload: CreateVideoPayload = {
        model: 'sora-2.0',
        params: { prompt: 'Test' },
      };

      await expect(createOpenAICompatibleVideo(payload, mockOptions)).rejects.toThrow(
        'Invalid response: missing id',
      );
    });
  });
});

describe('pollOpenAICompatibleVideoStatus', () => {
  it('should return success with videoUrl when completed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'completed',
        url: 'https://cdn.openai.com/video.mp4',
      }),
    });

    const result = await pollOpenAICompatibleVideoStatus('task-123', {
      apiKey: 'test-key',
      baseURL: 'https://api.openai.com/v1',
    });

    expect(result).toEqual({
      status: 'success',
      videoUrl: 'https://cdn.openai.com/video.mp4',
      headers: {
        Authorization: 'Bearer test-key',
      },
    });
  });

  it('should construct content endpoint URL when no url returned', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'completed',
      }),
    });

    const result = await pollOpenAICompatibleVideoStatus('task-123', {
      apiKey: 'test-key',
      baseURL: 'https://api.openai.com/v1',
    });

    expect(result).toEqual({
      status: 'success',
      videoUrl: 'https://api.openai.com/v1/videos/task-123/content',
      headers: {
        Authorization: 'Bearer test-key',
      },
    });
  });

  it('should return failed status when task failed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'failed',
        error: { message: 'Content policy violation' },
      }),
    });

    const result = await pollOpenAICompatibleVideoStatus('task-123', {
      apiKey: 'test-key',
      baseURL: 'https://api.openai.com/v1',
    });

    expect(result).toEqual({
      status: 'failed',
      error: 'Content policy violation',
    });
  });

  it('should return pending status when still processing', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'in_progress',
        progress: 50,
      }),
    });

    const result = await pollOpenAICompatibleVideoStatus('task-123', {
      apiKey: 'test-key',
      baseURL: 'https://api.openai.com/v1',
    });

    expect(result).toEqual({ status: 'pending' });
  });

  it('should throw on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Server error',
    });

    await expect(
      pollOpenAICompatibleVideoStatus('invalid-task', {
        apiKey: 'test-key',
        baseURL: 'https://api.openai.com/v1',
      }),
    ).rejects.toThrow('OpenAI-compatible video status API error: 500 Server error');
  });

  it('should fall back to v2 status API when v1 status endpoint is missing', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'not found',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            output: 'https://cdn.example.com/v2-video.mp4',
            usage: { completion_tokens: 10, total_tokens: 12 },
          },
          status: 'succeeded',
          task_id: 'task-123',
        }),
      });

    const result = await pollOpenAICompatibleVideoStatus('task-123', {
      apiKey: 'test-key',
      baseURL: 'http://localhost:8000/v1',
    });

    expect(result).toEqual({
      status: 'success',
      usage: { completionTokens: 10, totalTokens: 12 },
      videoUrl: 'https://cdn.example.com/v2-video.mp4',
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8000/v2/videos/generations/task-123',
      expect.any(Object),
    );
  });
});

describe('queryOpenAICompatibleVideoStatus', () => {
  it('should return parsed JSON response', async () => {
    const mockResponse = {
      id: 'task-123',
      status: 'completed',
      url: 'https://cdn.example.com/video.mp4',
      created_at: 1234567890,
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await queryOpenAICompatibleVideoStatus('task-123', {
      apiKey: 'test-key',
      baseURL: 'https://api.openai.com/v1',
    });

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/videos/task-123', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer test-key',
        'Content-Type': 'application/json',
      },
    });
  });
});
