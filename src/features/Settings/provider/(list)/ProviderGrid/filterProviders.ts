import { AiProviderSourceEnum } from '@/types/aiProvider';

export const filterUserVisibleProviders = <T extends { source?: string }>(providers: T[]) =>
  providers.filter((provider) => provider.source !== AiProviderSourceEnum.Custom);
