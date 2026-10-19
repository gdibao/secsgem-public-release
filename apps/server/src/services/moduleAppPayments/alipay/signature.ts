import { sign, verify } from 'node:crypto';

type AlipayParameterValue = boolean | null | number | string | undefined;

export const canonicalizeAlipayParameters = (
  parameters: Record<string, AlipayParameterValue>,
  options: { excludeSignType?: boolean } = {},
) =>
  Object.entries(parameters)
    .filter(([key, value]) => {
      if (key === 'sign' || (options.excludeSignType && key === 'sign_type')) return false;
      return value !== undefined && value !== null && String(value) !== '';
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');

export const signAlipayParameters = (
  parameters: Record<string, AlipayParameterValue>,
  privateKey: string,
  options: { excludeSignType?: boolean } = {},
) =>
  sign('RSA-SHA256', Buffer.from(canonicalizeAlipayParameters(parameters, options)), privateKey)
    .toString('base64');

export const signAlipayContent = (content: string, privateKey: string) =>
  sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64');

export const verifyAlipayContentSignature = (
  content: string,
  signature: string,
  publicKey: string,
) =>
  verify(
    'RSA-SHA256',
    Buffer.from(content),
    publicKey,
    Buffer.from(signature, 'base64'),
  );

export const verifyAlipaySignature = (
  parameters: Record<string, AlipayParameterValue>,
  publicKey: string,
  options: { excludeSignType?: boolean } = {},
) => {
  const signature = parameters.sign;
  if (typeof signature !== 'string' || !signature) return false;
  return verify(
    'RSA-SHA256',
    Buffer.from(canonicalizeAlipayParameters(parameters, options)),
    publicKey,
    Buffer.from(signature, 'base64'),
  );
};
