export const ADMIN_MODEL_TYPE_LABELS = {
  chat: '对话',
  embedding: '向量',
  image: '图像',
  realtime: '实时',
  stt: '语音转文字',
  text2music: '文生音乐',
  tts: '文字转语音',
  video: '视频',
} as const;

export type AdminModelType = keyof typeof ADMIN_MODEL_TYPE_LABELS;

export const getAdminModelTypeLabel = (type: string) =>
  ADMIN_MODEL_TYPE_LABELS[type as AdminModelType] ?? type;
