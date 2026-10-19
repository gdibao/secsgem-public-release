import type * as BusinessModelRuntimeModule from '@lobechat/business-model-runtime';
import { AsyncTaskStatus } from '@lobechat/types';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import { getServerDB } from '@/database/server';
import { VideoGenerationService } from '@/server/services/generation/video';

import { videoWebhook } from '../video';

const mocks = vi.hoisted(() => ({
  chargeAfterGenerate: vi.fn(),
  createAssetAndFile: vi.fn(),
  findByAsyncTaskId: vi.fn(),
  findByInferenceId: vi.fn(),
  getServerDB: vi.fn(),
  handleCreateVideoWebhook: vi.fn(),
  notifyVideoCompleted: vi.fn(),
  processVideoForGeneration: vi.fn(),
  resolveBusinessModelMapping: vi.fn(),
  updateAsyncTask: vi.fn(),
}));

vi.mock('@lobechat/model-runtime', () => ({
  ModelRuntime: {
    initializeWithProvider: vi.fn(() => ({
      handleCreateVideoWebhook: mocks.handleCreateVideoWebhook,
    })),
  },
}));

vi.mock('@lobechat/business-model-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof BusinessModelRuntimeModule>();

  return {
    ...actual,
    resolveBusinessModelMapping: mocks.resolveBusinessModelMapping,
  };
});

vi.mock('@/business/server/video-generation/chargeAfterGenerate', () => ({
  chargeAfterGenerate: mocks.chargeAfterGenerate,
}));

vi.mock('@/business/server/video-generation/notifyVideoCompleted', () => ({
  notifyVideoCompleted: mocks.notifyVideoCompleted,
}));

vi.mock('@/database/server', () => ({
  getServerDB: mocks.getServerDB,
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: Object.assign(
    vi.fn(function () {
      return {
        update: mocks.updateAsyncTask,
      };
    }),
    {
      findByInferenceId: mocks.findByInferenceId,
    },
  ),
}));

vi.mock('@/database/models/generation', () => ({
  GenerationModel: vi.fn(function () {
    return {
      createAssetAndFile: mocks.createAssetAndFile,
      findByAsyncTaskId: mocks.findByAsyncTaskId,
    };
  }),
}));

vi.mock('@/server/services/generation/video', () => ({
  VideoGenerationService: vi.fn(function () {
    return {
      processVideoForGeneration: mocks.processVideoForGeneration,
    };
  }),
}));

vi.mock('@/utils/sanitizeFileName', () => ({
  sanitizeFileName: vi.fn((prompt: string, id: string) => `${prompt}-${id}`),
}));

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

const app = new Hono().post('/api/webhooks/video/:provider', videoWebhook);

const createRequest = (body: unknown, token = 'webhook-token') =>
  new Request(`https://example.com/api/webhooks/video/volcengine?token=${token}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

describe('video webhook route', () => {
  const db = {
    query: {
      generationBatches: {
        findFirst: vi.fn(),
      },
    },
  };

  const asyncTask = {
    createdAt: new Date('2026-05-10T00:00:00.000Z'),
    id: 'task-1',
    metadata: {
      precharge: { estimatedCredits: 1000 },
      webhookToken: 'webhook-token',
    },
    status: AsyncTaskStatus.Processing,
    userId: 'user-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getServerDB.mockResolvedValue(db);
    mocks.findByInferenceId.mockResolvedValue(asyncTask);
    mocks.findByAsyncTaskId.mockResolvedValue({
      generationBatchId: 'batch-1',
      id: 'generation-1',
    });
    db.query.generationBatches.findFirst.mockResolvedValue({
      config: {
        generateAudio: true,
        resolution: '720p',
      },
      generationTopicId: 'topic-1',
      id: 'batch-1',
      model: 'video-alias',
      prompt: 'demo prompt',
    });
    mocks.resolveBusinessModelMapping.mockResolvedValue({
      requestedModelId: 'video-alias',
      resolvedModelId: 'video-real-model',
    });
    mocks.processVideoForGeneration.mockResolvedValue({
      coverKey: 'cover-key',
      duration: 3,
      fileHash: 'file-hash',
      fileSize: 1234,
      height: 720,
      mimeType: 'video/mp4',
      thumbnailKey: 'thumbnail-key',
      videoKey: 'video-key',
      width: 1280,
    });
  });

  it('passes the server db into successful webhook post-charge', async () => {
    mocks.handleCreateVideoWebhook.mockResolvedValue({
      inferenceId: 'infer-1',
      status: 'success',
      usage: { completionTokens: 500_000, totalTokens: 500_000 },
      videoUrl: 'https://cdn.example.com/video.mp4',
    });

    const response = await app.request(createRequest({ id: 'infer-1' }));

    expect(response.status).toBe(200);
    expect(getServerDB).toHaveBeenCalled();
    expect(AsyncTaskModel.findByInferenceId).toHaveBeenCalledWith(db, 'infer-1');
    expect(GenerationModel).toHaveBeenCalledWith(db, 'user-1', undefined);
    expect(VideoGenerationService).toHaveBeenCalledWith(db, 'user-1', undefined);
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        computePriceParams: {
          generateAudio: true,
          resolution: '720p',
        },
        db,
        metadata: expect.objectContaining({
          asyncTaskId: 'task-1',
          generationBatchId: 'batch-1',
          modelId: 'video-real-model',
          requestedModelId: 'video-alias',
          topicId: 'topic-1',
        }),
        model: 'video-real-model',
        prechargeResult: { estimatedCredits: 1000 },
        provider: 'volcengine',
        usage: { completionTokens: 500_000, totalTokens: 500_000 },
        userId: 'user-1',
      }),
    );
  });

  it('passes the server db into failed webhook refund path', async () => {
    mocks.handleCreateVideoWebhook.mockResolvedValue({
      error: 'provider failed',
      inferenceId: 'infer-1',
      status: 'error',
    });

    const response = await app.request(createRequest({ id: 'infer-1' }));

    expect(response.status).toBe(200);
    expect(mocks.updateAsyncTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: AsyncTaskStatus.Error }),
    );
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        isError: true,
        model: 'video-real-model',
        prechargeResult: { estimatedCredits: 1000 },
        provider: 'volcengine',
        userId: 'user-1',
      }),
    );
  });
});
