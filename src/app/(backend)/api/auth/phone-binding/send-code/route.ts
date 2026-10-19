import {
  phoneBindingErrorResponse,
  sendCasdoorPhoneCode,
} from '@/libs/better-auth/casdoor-phone-binding.server';

export const POST = async (request: Request) => {
  try {
    const body = (await request.json()) as {
      captchaId?: unknown;
      captchaToken?: unknown;
      phone?: unknown;
    };
    await sendCasdoorPhoneCode(request, body.phone, body.captchaId, body.captchaToken);
    return Response.json({ ok: true });
  } catch (error) {
    return phoneBindingErrorResponse(error);
  }
};
