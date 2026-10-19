import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/slices/settings/selectors';

export const getMarketTokensFromDB = () => {
  const settings = settingsSelectors.currentSettings(useUserStore.getState());
  return settings.market;
};

export const saveMarketTokensToDB = async (
  accessToken: string,
  refreshToken?: string,
  expiresAt?: number,
) => {
  try {
    await useUserStore.getState().setSettings({
      market: {
        accessToken,
        expiresAt,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('[MarketAuth] Failed to save tokens to DB:', error);
  }
};

export const clearMarketTokensFromDB = async () => {
  const currentTokens = getMarketTokensFromDB();
  if (!currentTokens?.accessToken && !currentTokens?.refreshToken && !currentTokens?.expiresAt) {
    return;
  }

  try {
    // `undefined` is ignored by the settings deep merge, so use null to clear the JSONB column.
    await useUserStore.getState().setSettings({ market: null });
  } catch (error) {
    console.error('[MarketAuth] Failed to clear tokens from DB:', error);
  }
};

export const getRefreshToken = (): string | null => {
  const dbTokens = getMarketTokensFromDB();
  return dbTokens?.refreshToken || null;
};
