const START_TIMEOUT_MS = 15_000;

export interface StartServerHarnessRunInput {
  agentType: 'codex' | 'dsh' | 'hermes' | 'openclaw';
  assistantMessageId: string;
  model?: { id: string; providerId: string };
  operationId: string;
  prompt: string;
  resumeSessionId?: string;
  systemContext?: string;
  topicId: string;
}

export const startServerHarnessRun = async (params: {
  gatewayUrl: string;
  operationToken: string;
  run: StartServerHarnessRunInput;
}): Promise<void> => {
  const response = await fetch(new URL('/v1/runs', params.gatewayUrl), {
    body: JSON.stringify(params.run),
    headers: {
      'authorization': `Bearer ${params.operationToken}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(START_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Harness gateway rejected the operation (${response.status})`);
  }
};

export const cancelServerHarnessRun = async (params: {
  gatewayUrl: string;
  operationId: string;
  operationToken: string;
}): Promise<boolean> => {
  const response = await fetch(
    new URL(`/v1/runs/${encodeURIComponent(params.operationId)}/cancel`, params.gatewayUrl),
    {
      headers: { authorization: `Bearer ${params.operationToken}` },
      method: 'POST',
      signal: AbortSignal.timeout(START_TIMEOUT_MS),
    },
  );
  return response.ok;
};
