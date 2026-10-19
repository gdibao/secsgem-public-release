import {
  confirmCasdoorPhoneCode,
  phoneBindingErrorResponse,
} from '@/libs/better-auth/casdoor-phone-binding.server';

export const POST = async (request: Request) => {
  try {
    const body = (await request.json()) as { code?: unknown; phone?: unknown };
    const sessionCookies = await confirmCasdoorPhoneCode(request, body.phone, body.code);
    const response = Response.json({ ok: true });
    for (const cookie of sessionCookies) response.headers.append('set-cookie', cookie);
    return response;
  } catch (error) {
    return phoneBindingErrorResponse(error);
  }
};
