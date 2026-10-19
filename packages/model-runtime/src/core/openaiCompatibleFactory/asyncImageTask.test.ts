import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOpenAICompatibleAsyncImageTask } from './asyncImageTask';

describe('openai compatible async image task', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('submits an Apifox-style async image task and polls until success', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ task_id: 'task-1' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              data: {
                data: [{ url: 'https://example.com/result.png' }],
              },
              status: 'SUCCESS',
            },
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        ),
      );

    const result = await createOpenAICompatibleAsyncImageTask(
      {
        model: 'jimeng-image-async',
        params: { prompt: 'draw async' },
      },
      {
        apiKey: 'sk-test',
        baseURL: 'https://api.example.com/v1',
        initialInterval: 1,
        maxInterval: 1,
        maxRetries: 2,
      },
    );

    expect(result).toEqual({ imageUrl: 'https://example.com/result.png' });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/v1/images/generations',
      expect.objectContaining({
        body: JSON.stringify({ async: true, model: 'jimeng-image-async', prompt: 'draw async' }),
        method: 'POST',
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/v1/images/tasks/task-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('keeps compatibility with flat status responses', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'task-flat' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ url: 'https://example.com/flat-result.png' }],
            status: 'succeeded',
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        ),
      );

    const result = await createOpenAICompatibleAsyncImageTask(
      {
        model: 'jimeng-image-async',
        params: { prompt: 'draw async' },
      },
      {
        apiKey: 'sk-test',
        baseURL: 'https://api.example.com/v1',
        initialInterval: 1,
        maxInterval: 1,
        maxRetries: 2,
      },
    );

    expect(result).toEqual({ imageUrl: 'https://example.com/flat-result.png' });
  });

  it('throws when submit response has no task id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );

    await expect(
      createOpenAICompatibleAsyncImageTask(
        {
          model: 'jimeng-image-async',
          params: { prompt: 'draw async' },
        },
        {
          apiKey: 'sk-test',
          baseURL: 'https://api.example.com/v1',
          maxRetries: 1,
        },
      ),
    ).rejects.toThrow('Invalid async image task response: missing task id');
  });
});
