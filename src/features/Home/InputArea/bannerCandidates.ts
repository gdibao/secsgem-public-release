export type BannerKind = 'skill' | 'botIntegration' | 'messenger';

type BannerCandidateOptions = {
  isBotIntegrationBannerDismissed: boolean;
  isComposioEnabled: boolean;
  isLobehubSkillEnabled: boolean;
  isMessengerBannerDismissed: boolean;
  isMessengerEnabled: boolean;
  isSkillBannerDismissed: boolean;
};

export const getHomeInputBannerCandidates = ({
  isBotIntegrationBannerDismissed,
  isComposioEnabled,
  isLobehubSkillEnabled,
  isMessengerBannerDismissed,
  isMessengerEnabled,
  isSkillBannerDismissed,
}: BannerCandidateOptions): BannerKind[] => {
  const candidates: BannerKind[] = [];

  if ((isLobehubSkillEnabled || isComposioEnabled) && !isSkillBannerDismissed) {
    candidates.push('skill');
  }

  if (!isBotIntegrationBannerDismissed) candidates.push('botIntegration');
  if (isMessengerEnabled && !isMessengerBannerDismissed) candidates.push('messenger');

  return candidates;
};
