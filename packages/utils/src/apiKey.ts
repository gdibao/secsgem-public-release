import { randomBytes } from 'node:crypto';

import * as businessConst from '@lobechat/business-const';

/**
 * A distribution's `@lobechat/business-const` override replaces the whole
 * module rather than extending it, so older overrides may omit `API_KEY_PREFIX`.
 */
const configuredApiKeyPrefix = (businessConst as Record<string, unknown>).API_KEY_PREFIX;
export const API_KEY_PREFIX =
  typeof configuredApiKeyPrefix === 'string' ? configuredApiKeyPrefix : 'sk-lh-';

const API_KEY_RANDOM_BYTES = 32;
const LEGACY_API_KEY_SUFFIX_PATTERN = /^[\da-z]{16}$/;
const SECURE_API_KEY_SUFFIX_PATTERN = /^[\da-f]{64}$/;

/**
 * Generate API Key.
 * Format: `${API_KEY_PREFIX}{64 lowercase hexadecimal characters}`
 * @returns Generated API Key
 */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(API_KEY_RANDOM_BYTES).toString('hex')}`;
}

/**
 * Check if API Key is expired.
 * @param expiresAt - Expiration time
 * @returns Whether the key has expired
 */
export function isApiKeyExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return new Date() > expiresAt;
}

/**
 * Validate API Key format. Both the legacy 16-character format and the secure
 * 32-byte hexadecimal format remain accepted for existing keys.
 *
 * The prefix is compared directly rather than interpolated into a RegExp so a
 * configurable distribution prefix is handled safely.
 *
 * @param key - API Key to validate
 * @returns Whether the key has a valid format
 */
export function validateApiKeyFormat(key: string): boolean {
  if (!key.startsWith(API_KEY_PREFIX)) return false;

  const suffix = key.slice(API_KEY_PREFIX.length);
  return LEGACY_API_KEY_SUFFIX_PATTERN.test(suffix) || SECURE_API_KEY_SUFFIX_PATTERN.test(suffix);
}
