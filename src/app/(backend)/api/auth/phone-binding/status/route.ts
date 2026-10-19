import { auth } from '@/auth';
import { authEnv } from '@/envs/auth';
import { isPhoneBindingExempt } from '@/libs/better-auth/phone-identity';

export const GET = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user?.id;
  if (!userId) return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });

  const canSkip =
    !authEnv.AUTH_PHONE_BINDING_REQUIRED ||
    isPhoneBindingExempt(userId, authEnv.AUTH_PHONE_BINDING_EXEMPT_USER_IDS);

  return Response.json({ canSkip });
};
