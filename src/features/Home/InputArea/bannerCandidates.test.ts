import { describe, expect, it } from 'vitest';

import { getHomeInputBannerCandidates } from './bannerCandidates';

describe('getHomeInputBannerCandidates', () => {
  it('does not include the messenger banner when admin disables the entry', () => {
    expect(
      getHomeInputBannerCandidates({
        isBotIntegrationBannerDismissed: true,
        isComposioEnabled: false,
        isLobehubSkillEnabled: false,
        isMessengerBannerDismissed: false,
        isMessengerEnabled: false,
        isSkillBannerDismissed: true,
      }),
    ).toEqual([]);
  });

  it('includes the messenger banner when admin enables the entry and it is not dismissed', () => {
    expect(
      getHomeInputBannerCandidates({
        isBotIntegrationBannerDismissed: true,
        isComposioEnabled: false,
        isLobehubSkillEnabled: false,
        isMessengerBannerDismissed: false,
        isMessengerEnabled: true,
        isSkillBannerDismissed: true,
      }),
    ).toEqual(['messenger']);
  });
});
