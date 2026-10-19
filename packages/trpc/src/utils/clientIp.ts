export const extractClientIp = (headers: Headers): string | undefined => {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ip = forwardedFor.split(',')[0]?.trim();
    if (ip) return ip;
  }

  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  return undefined;
};
