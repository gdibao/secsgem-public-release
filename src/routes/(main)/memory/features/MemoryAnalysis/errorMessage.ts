export const getMemoryAnalysisErrorMessage = (error: unknown, fallback: string) => {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : '';

  const detail = message.trim();

  return detail ? `${fallback}：${detail}` : fallback;
};
