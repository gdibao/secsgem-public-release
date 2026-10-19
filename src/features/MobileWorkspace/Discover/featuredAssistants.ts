import type { MobileResolvedFeaturedAssistantV1 } from '@/const/mobileConfig';

export interface MobileFeaturedAssistantCard extends MobileResolvedFeaturedAssistantV1 {
  routePath: string;
}

export const buildFeaturedAssistantCards = (
  assistants: MobileResolvedFeaturedAssistantV1[],
): MobileFeaturedAssistantCard[] =>
  assistants.slice(0, 4).map((assistant) => ({
    ...assistant,
    routePath: `/community/agent/${encodeURIComponent(assistant.identifier)}`,
  }));
