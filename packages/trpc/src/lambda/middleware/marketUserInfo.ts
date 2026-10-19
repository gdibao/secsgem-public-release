import { type LobeChatDatabase } from '@lobechat/database';

import { UserModel } from '@/database/models/user';
import { type TrustedClientUserInfo } from '@/libs/trusted-client';

import { trpc } from '../init';

interface ContextWithServerDB {
  marketAccessToken?: string;
  serverDB?: LobeChatDatabase;
  userId?: string | null;
  workspaceId?: string | null;
}

interface MarketUserContext {
  marketAccessToken?: string;
  marketUserInfo?: TrustedClientUserInfo;
}

export const resolveMarketUserContext = async (
  ctx: ContextWithServerDB,
  options: { includePersistedMarketToken?: boolean } = {},
): Promise<MarketUserContext> => {
  const requestContext = { marketAccessToken: ctx.marketAccessToken };

  if (!ctx.userId || !ctx.serverDB) {
    return { ...requestContext, marketUserInfo: undefined };
  }

  try {
    const user = await UserModel.findById(ctx.serverDB, ctx.userId);

    if (!user || !user.email) {
      return { ...requestContext, marketUserInfo: undefined };
    }

    const marketUserInfo: TrustedClientUserInfo = {
      email: user.email,
      name: user.fullName || user.username || undefined,
      userId: ctx.userId,
      // In a workspace context, the token acts as the workspace's mirrored
      // organization; absent for personal requests.
      ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
    };

    if (options.includePersistedMarketToken === false) {
      return { ...requestContext, marketUserInfo };
    }

    const userModel = new UserModel(ctx.serverDB, ctx.userId);
    const userSettings = await userModel.getUserSettings();
    const marketTokenFromDB = (userSettings?.market as any)?.accessToken;

    return {
      marketAccessToken: marketTokenFromDB || ctx.marketAccessToken,
      marketUserInfo,
    };
  } catch {
    // Market discovery should remain available when the local user lookup is
    // temporarily unavailable; the request-scoped token is still usable.
    return { ...requestContext, marketUserInfo: undefined };
  }
};

const createMarketUserInfoMiddleware = (options: { includePersistedMarketToken: boolean }) =>
  trpc.middleware(async (opts) => {
    const ctx = opts.ctx as ContextWithServerDB;
    const marketContext = await resolveMarketUserContext(ctx, options);

    return opts.next({ ctx: marketContext });
  });

/**
 * Middleware that fetches user info for Market trusted client authentication.
 * This requires serverDatabase middleware to be applied first.
 */
export const marketUserInfo = createMarketUserInfoMiddleware({
  includePersistedMarketToken: true,
});

/**
 * Public Market discovery requests keep the request-scoped token instead of a
 * persisted user token, which may expire independently.
 */
export const marketPublicUserInfo = createMarketUserInfoMiddleware({
  includePersistedMarketToken: false,
});
