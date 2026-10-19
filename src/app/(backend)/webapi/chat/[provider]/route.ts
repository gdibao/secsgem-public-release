import {
  REQUEST_ASSISTANT_MESSAGE_ID_HEADER,
  REQUEST_MESSAGE_ID_HEADER,
  REQUEST_OPERATION_ID_HEADER,
  REQUEST_TOPIC_ID_HEADER,
} from '@lobechat/const';
import { AGENT_RUNTIME_ERROR_SET, type ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { createTraceOptions, initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { type ChatStreamPayload } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';
import { getTracePayload } from '@/utils/trace';

import { resolveValidWorkspaceIdFromRequest } from '../../_utils/workspace';

// If user don't use fluid compute, will build  failed
// this enforce user to enable fluid compute
export const maxDuration = 300;

const getStringHeader = (req: Request, key: string) => {
  const value = req.headers.get(key);
  return value?.trim() || undefined;
};

const getRequestMetadata = (req: Request) => {
  const metadata = {
    messageId: getStringHeader(req, REQUEST_MESSAGE_ID_HEADER),
    assistantMessageId: getStringHeader(req, REQUEST_ASSISTANT_MESSAGE_ID_HEADER),
    operationId: getStringHeader(req, REQUEST_OPERATION_ID_HEADER),
    topicId: getStringHeader(req, REQUEST_TOPIC_ID_HEADER),
  };

  const entries = Object.entries(metadata).filter(([, value]) => value);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

export const POST = checkAuth(async (req: Request, { params, userId, serverDB }) => {
  const provider = (await params)!.provider!;

  try {
    const data = (await req.json()) as ChatStreamPayload;
    const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });

    // ============  1. init chat model   ============ //
    const modelRuntime = await initModelRuntimeFromDB(serverDB, userId, provider, {
      model: data.model,
      modelType: 'chat',
      workspaceId,
    });

    // ============  2. create chat completion   ============ //

    const tracePayload = getTracePayload(req);

    let traceOptions = {};
    // If user enable trace
    if (tracePayload?.enabled) {
      traceOptions = createTraceOptions(data, { provider, trace: tracePayload });
    }

    const metadata = getRequestMetadata(req);

    return await modelRuntime.chat(data, {
      ...(metadata && { metadata }),
      user: userId,
      ...traceOptions,
      signal: req.signal,
    });
  } catch (e) {
    const {
      errorType = ChatErrorType.InternalServerError,
      error: errorContent,
      ...res
    } = e as ChatCompletionErrorPayload;

    const error = errorContent || e;

    // track the error at server side
    if (AGENT_RUNTIME_ERROR_SET.has(errorType as string)) {
      console.warn(`Route: [${provider}] ${errorType}:`, error);
    } else {
      console.error(`Route: [${provider}] ${errorType}:`, error);
    }

    return createErrorResponse(errorType, { error, ...res, provider });
  }
});
