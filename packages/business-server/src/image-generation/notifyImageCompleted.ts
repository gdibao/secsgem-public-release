interface NotifyImageCompletedParams {
  duration: number;
  generationBatchId: string;
  model: string;
  prompt: string;
  topicId?: string;
  userId: string;
  /** Present when the generation ran in a workspace — the notification then follows that context. */
  workspaceId?: string;
}

/**
 * Notify user that image generation is completed.
 * Currently a no-op placeholder. Can be extended to send push notifications,
 * in-app messages, or email notifications in future iterations.
 */
export async function notifyImageCompleted(_params: NotifyImageCompletedParams): Promise<void> {
  // TODO: Implement notification logic in future iteration
}
