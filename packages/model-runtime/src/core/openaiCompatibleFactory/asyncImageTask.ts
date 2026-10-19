import type { RuntimeImageGenParams } from 'model-bank';

import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { asyncifyPolling, type TaskResult } from '../../utils/asyncifyPolling';

type AsyncImageTaskOptions = {
  apiKey: string;
  baseURL: string;
  initialInterval?: number;
  maxInterval?: number;
  maxRetries?: number;
};

type AsyncImageTaskSubmitResponse = {
  id?: string;
  task_id?: string;
};

type AsyncImageTaskStatusResponse = {
  data?:
    | Array<{ b64_json?: string; url?: string }>
    | {
        data?: {
          data?: Array<{ b64_json?: string; url?: string }>;
        };
        status?: string;
      };
  error?: { message?: string } | string;
  status?: string;
};

const getTaskId = (response: AsyncImageTaskSubmitResponse) => response.id ?? response.task_id;

const buildCreateTaskBody = (payload: CreateImagePayload) => {
  const { model, params } = payload;
  const { prompt, ...rest } = params as RuntimeImageGenParams;

  return {
    async: true,
    model,
    prompt,
    ...rest,
  };
};

const getTaskStatus = (response: AsyncImageTaskStatusResponse) => {
  const nestedData = Array.isArray(response.data) ? undefined : response.data;

  return (response.status ?? nestedData?.status)?.toLowerCase();
};

const getTaskImages = (response: AsyncImageTaskStatusResponse) => {
  if (Array.isArray(response.data)) return response.data;

  return response.data?.data?.data;
};

const parseImageTaskResult = (
  response: AsyncImageTaskStatusResponse,
): TaskResult<CreateImageResponse> => {
  const status = getTaskStatus(response);

  if (status === 'succeeded' || status === 'success' || status === 'completed') {
    const image = getTaskImages(response)?.[0];
    const imageUrl =
      image?.url ?? (image?.b64_json ? `data:image/png;base64,${image.b64_json}` : undefined);

    if (!imageUrl) {
      return {
        error: new Error('Async image task succeeded but no image URL found'),
        status: 'failed',
      };
    }

    return { data: { imageUrl }, status: 'success' };
  }

  if (status === 'failed' || status === 'failure' || status === 'error') {
    const errorMessage =
      typeof response.error === 'string'
        ? response.error
        : response.error?.message || 'Async image task failed';

    return { error: new Error(errorMessage), status: 'failed' };
  }

  return { status: 'pending' };
};

const readJson = async <T>(response: Response, errorPrefix: string): Promise<T> => {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${errorPrefix}: ${response.status} ${errorText}`);
  }

  return (await response.json()) as T;
};

export const createOpenAICompatibleAsyncImageTask = async (
  payload: CreateImagePayload,
  options: AsyncImageTaskOptions,
): Promise<CreateImageResponse> => {
  const baseURL = options.baseURL.replace(/\/$/, '');

  const submitResponse = await fetch(`${baseURL}/images/generations`, {
    body: JSON.stringify(buildCreateTaskBody(payload)),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  const submitData = await readJson<AsyncImageTaskSubmitResponse>(
    submitResponse,
    'Async image task submit API error',
  );
  const taskId = getTaskId(submitData);

  if (!taskId) {
    throw new Error('Invalid async image task response: missing task id');
  }

  return await asyncifyPolling<AsyncImageTaskStatusResponse, CreateImageResponse>({
    checkStatus: parseImageTaskResult,
    initialInterval: options.initialInterval,
    maxInterval: options.maxInterval,
    maxRetries: options.maxRetries,
    pollingQuery: async () => {
      const statusResponse = await fetch(`${baseURL}/images/tasks/${taskId}`, {
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
        },
        method: 'GET',
      });

      return await readJson<AsyncImageTaskStatusResponse>(
        statusResponse,
        'Async image task status API error',
      );
    },
  });
};
