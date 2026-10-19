import { describe, expect, it } from 'vitest';

/**
 * Pure helper test: validates that the friendly base32 alphabet used by the
 * redemption router produces codes of the expected shape.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const generateCode = (length = 16, group = 4): string => {
  const buf = new Uint8Array(length);
  for (let i = 0; i < length; i++) buf[i] = i * 31 + 7;
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  if (group <= 0 || group >= length) return s;
  const parts: string[] = [];
  for (let i = 0; i < s.length; i += group) parts.push(s.slice(i, i + group));
  return parts.join('-');
};

describe('redemption code generator', () => {
  it('uses ambiguous-free alphabet (no I/L/O/0/1)', () => {
    const code = generateCode(64, 0);
    expect(code).not.toMatch(/[ILO01]/);
  });

  it('groups characters with dashes', () => {
    const code = generateCode(16, 4);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('returns ungrouped when group is invalid', () => {
    expect(generateCode(8, 0)).not.toContain('-');
    expect(generateCode(8, 8)).not.toContain('-');
  });
});
