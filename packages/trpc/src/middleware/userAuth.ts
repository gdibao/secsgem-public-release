import { TRPCError } from '@trpc/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { authEnv } from '@/envs/auth';
import {
  findVerifiedPhoneIdentity,
  hasVerifiedPhoneIdentity,
  isPhoneBindingExempt,
} from '@/libs/better-auth/phone-identity';

import { trpc } from '../lambda/init';

export const userAuth = trpc.middleware(async (opts) => {
  const { ctx } = opts;

  // `ctx.user` is nullable
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  if (
    authEnv.AUTH_PHONE_BINDING_REQUIRED &&
    !isPhoneBindingExempt(ctx.userId, authEnv.AUTH_PHONE_BINDING_EXEMPT_USER_IDS)
  ) {
    const user = await findVerifiedPhoneIdentity(await getServerDB(), ctx.userId);
    if (!user || !hasVerifiedPhoneIdentity(user)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'phone_binding_required' });
    }
  }

  return opts.next({
    // ✅ user value is known to be non-null now
    ctx: { userId: ctx.userId },
  });
});
