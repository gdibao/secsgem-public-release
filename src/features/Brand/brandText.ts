export const replaceLegacyBrandTokens = (value: string, brandName: string) =>
  value.replaceAll(/\bLobe\s*AI\b|LobeHub|Qingyou\s*AI|玄果(?:\s*AI)?/gi, brandName);
