import createDebug from 'debug';
import { ModelProvider } from 'model-bank';

import type {
  CreateVideoPayload,
  CreateVideoResponse,
  PollVideoStatusResult,
} from '../../types/video';
import { resolveMappedModelId } from '../../utils/modelIdMapping';
import type { CreateVideoOptions } from '../openaiCompatibleFactory';

const log = createDebug('lobe-video:openai-compatible');

interface OpenAIVideoStatusResponse {
  completed_at?: number;
  created?: number;
  created_at?: number;
  duration?: number;
  error?: {
    code?: string;
    message?: string;
  };
  expires_at?: number;
  height?: number;
  id?: string;
  model?: string;
  object?: string;
  progress?: number;
  prompt?: string;
  seconds?: string;
  size?: string;
  status?: string;
  url?: string;
  width?: number;
}

interface OpenAICompatibleVideoError extends Error {
  status?: number;
}

interface OpenAIV2VideoTaskResponse {
  data?: {
    error?: string;
    output?: string;
    usage?: {
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  error?: {
    message?: string;
  };
  id?: string;
  status?: string;
  task_id?: string;
}

const createVideoError = (message: string, status?: number): OpenAICompatibleVideoError => {
  const error = new Error(message) as OpenAICompatibleVideoError;
  error.status = status;
  return error;
};

const normalizeBaseURL = (baseURL: string) => baseURL.replace(/\/$/, '');

const toV2BaseURL = (baseURL: string) => {
  const normalized = normalizeBaseURL(baseURL || 'https://api.openai.com/v1');
  return normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized;
};

/**
 * Query the status of a video generation task
 * Compatible with OpenAI Sora API
 */
export async function queryOpenAICompatibleVideoStatus(
  inferenceId: string,
  options: { apiKey: string; baseURL: string },
): Promise<OpenAIVideoStatusResponse> {
  const statusUrl = `${normalizeBaseURL(options.baseURL)}/videos/${inferenceId}`;

  log('Querying video status for: %s', inferenceId);

  const response = await fetch(statusUrl, {
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw createVideoError(
      `OpenAI-compatible video status API error: ${response.status} ${errorText}`,
      response.status,
    );
  }

  const data = (await response.json()) as OpenAIVideoStatusResponse;
  log('Video status response: %O', data);

  return data;
}

async function queryOpenAIV2VideoGenerationStatus(
  inferenceId: string,
  options: { apiKey: string; baseURL: string },
): Promise<OpenAIV2VideoTaskResponse> {
  const statusUrl = `${toV2BaseURL(options.baseURL)}/v2/videos/generations/${inferenceId}`;

  const response = await fetch(statusUrl, {
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw createVideoError(
      `OpenAI-compatible video v2 status API error: ${response.status} ${errorText}`,
      response.status,
    );
  }

  return (await response.json()) as OpenAIV2VideoTaskResponse;
}

function parseOpenAIV2VideoStatus(response: OpenAIV2VideoTaskResponse): PollVideoStatusResult {
  const status = response.status?.toLowerCase();

  if (['success', 'succeeded', 'completed'].includes(status || '')) {
    const videoUrl = response.data?.output;
    if (!videoUrl) return { error: 'Task succeeded but no video URL found', status: 'failed' };

    return {
      status: 'success',
      ...(response.data?.usage && {
        usage: {
          completionTokens: response.data.usage.completion_tokens ?? 0,
          totalTokens: response.data.usage.total_tokens ?? 0,
        },
      }),
      videoUrl,
    };
  }

  if (['failed', 'failure', 'error'].includes(status || '')) {
    return {
      error: response.data?.error || response.error?.message || 'Video generation failed',
      status: 'failed',
    };
  }

  return { status: 'pending' };
}

/**
 * Poll video status and return standardized result
 * Compatible with OpenAI Sora API
 */
export async function pollOpenAICompatibleVideoStatus(
  inferenceId: string,
  options: { apiKey: string; baseURL: string },
): Promise<PollVideoStatusResult> {
  let response: OpenAIVideoStatusResponse;
  try {
    response = await queryOpenAICompatibleVideoStatus(inferenceId, options);
  } catch (error) {
    if ((error as OpenAICompatibleVideoError).status === 404) {
      return parseOpenAIV2VideoStatus(
        await queryOpenAIV2VideoGenerationStatus(inferenceId, options),
      );
    }

    throw error;
  }

  if (response.status === 'completed') {
    // Some providers return the download URL directly in the url field
    // Others require calling /videos/{id}/content endpoint
    let videoUrl = response.url;

    if (!videoUrl) {
      // If no URL returned, construct the content endpoint URL
      videoUrl = `${normalizeBaseURL(options.baseURL)}/videos/${inferenceId}/content`;
    }

    // Return headers for authenticated download
    // OpenAI-compatible providers use Bearer token
    return {
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
      },
      status: 'success',
      videoUrl,
    };
  }

  if (response.status === 'failed') {
    return {
      error: response.error?.message || 'Video generation failed',
      status: 'failed',
    };
  }

  // queued, in_progress, or any other status means still pending
  return { status: 'pending' };
}

/**
 * OpenAI-compatible video generation implementation
 * Works with OpenAI Sora, and other OpenAI-compatible providers
 *
 * API Format:
 * POST /v1/videos
 * {
 *   model: string,
 *   prompt: string,
 *   seconds?: string,      // OpenAI Sora format (string type)
 *   input_reference?: string | { image_url: string } | { file_id: string },  // For image-to-video
 * }
 *
 * Creates a video generation task and returns immediately with inferenceId.
 * The frontend polls the task status using async task polling mechanism.
 */
export async function createOpenAICompatibleVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const requestModel = resolveMappedModelId(model, options);
  const { prompt, imageUrl, size, duration } = params;

  log('Creating video with OpenAI-compatible API - model: %s, params: %O', requestModel, params);

  const baseURL = normalizeBaseURL(options.baseURL || 'https://api.openai.com/v1');

  // Build request body compatible with OpenAI Sora
  const body: Record<string, unknown> = {
    model: requestModel,
    prompt,
  };

  // Duration: prefer 'seconds' (string) for OpenAI Sora compatibility
  if (duration !== undefined && duration !== null) {
    body['seconds'] = duration.toString();
  }

  // Size/resolution
  if (size) {
    body['size'] = size;
  }

  // Image-to-video support
  if (imageUrl) {
    // OpenAI JSON requests reject bare strings, for example:
    // `input_reference: "https://example.com/image.jpg"`.
    body['input_reference'] =
      options.provider === ModelProvider.OpenAI ? { image_url: imageUrl } : imageUrl;
  }

  log('OpenAI-compatible video API request body: %O', body);

  const requestOptions = {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  };

  const response = await fetch(`${baseURL}/videos`, requestOptions);

  if (!response.ok) {
    const errorText = await response.text();
    log('OpenAI-compatible video API error: %s %s', response.status, errorText);

    if (response.status !== 404) {
      throw createVideoError(
        `OpenAI-compatible video API error: ${response.status} ${errorText}`,
        response.status,
      );
    }

    const fallbackBody = {
      model,
      prompt,
      ...(duration !== undefined && duration !== null ? { duration } : {}),
      ...(imageUrl ? { image: imageUrl } : {}),
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(size ? { size } : {}),
    };

    const fallbackResponse = await fetch(`${toV2BaseURL(baseURL)}/v2/videos/generations`, {
      ...requestOptions,
      body: JSON.stringify(fallbackBody),
    });

    if (!fallbackResponse.ok) {
      const fallbackErrorText = await fallbackResponse.text();
      throw createVideoError(
        `OpenAI-compatible video v2 API error: ${fallbackResponse.status} ${fallbackErrorText}`,
        fallbackResponse.status,
      );
    }

    const fallbackData = (await fallbackResponse.json()) as OpenAIV2VideoTaskResponse;
    const inferenceId = fallbackData.task_id ?? fallbackData.id;
    if (!inferenceId) {
      throw new Error('Invalid response: missing task_id');
    }

    return { inferenceId };
  }

  const data = await response.json();
  log('OpenAI-compatible video API response: %O', data);

  if (!data?.id) {
    throw new Error('Invalid response: missing id');
  }

  const inferenceId = data.id;
  log('Video task created with id: %s, returning immediately for frontend polling', inferenceId);

  // Return immediately with inferenceId only
  // Frontend will poll the task status using the async task polling mechanism
  // This avoids blocking the API response for 30 seconds during server-side polling
  return { inferenceId };
}
