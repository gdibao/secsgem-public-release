import {
  getCasdoorPhoneCaptcha,
  phoneBindingErrorResponse,
} from '@/libs/better-auth/casdoor-phone-binding.server';

export const POST = async (request: Request) => {
  try {
    return Response.json(await getCasdoorPhoneCaptcha(request));
  } catch (error) {
    return phoneBindingErrorResponse(error);
  }
};
