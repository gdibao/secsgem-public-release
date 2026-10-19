export type OpenAICompatibleImageRouteMode = 'async-image-task' | 'chat-image' | 'openai-images';

export const resolveImageRouteMode = (
  model: string,
  params?: Record<string, unknown>,
): OpenAICompatibleImageRouteMode => {
  if (model.endsWith(':image')) return 'chat-image';
  if (params?.async === true) return 'async-image-task';
  if (model.endsWith('-async') || model.includes(':async')) return 'async-image-task';

  return 'openai-images';
};
