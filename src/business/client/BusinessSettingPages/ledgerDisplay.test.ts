import { describe, expect, it } from 'vitest';

import { formatCreditLedgerDescription } from './ledgerDisplay';

describe('formatCreditLedgerDescription', () => {
  it('hides provider UUIDs from model consumption descriptions', () => {
    expect(
      formatCreditLedgerDescription('Consumed on 757e1732-8478-4c93-a4dd-1e17489a9c48/deepseek-v4-pro'),
    ).toBe('模型调用：deepseek-v4-pro');
  });

  it('uses metadata display names before raw provider UUIDs and model ids', () => {
    expect(
      formatCreditLedgerDescription(
        'Consumed on 757e1732-8478-4c93-a4dd-1e17489a9c48/deepseek-v4-pro',
        {
          instanceName: 'ToAPI',
          modelDisplayName: 'DeepSeek V4 Pro',
        },
      ),
    ).toBe('模型调用：DeepSeek V4 Pro · 服务商：ToAPI');
  });

  it('falls back to provider metadata when the raw provider is not readable', () => {
    expect(
      formatCreditLedgerDescription(
        'Consumed on 757e1732-8478-4c93-a4dd-1e17489a9c48/deepseek-v4-pro',
        {
          providerType: 'newapi',
        },
      ),
    ).toBe('模型调用：deepseek-v4-pro · 服务商：newapi');
  });

  it('keeps readable provider names when available', () => {
    expect(formatCreditLedgerDescription('Consumed on siliconflow/deepseek-v3')).toBe(
      '模型调用：deepseek-v3 · 服务商：siliconflow',
    );
  });

  it('falls back to the original description for non-model ledger text', () => {
    expect(formatCreditLedgerDescription('Manual top-up')).toBe('Manual top-up');
  });

  it('keeps model ids with slash segments readable', () => {
    const formatted = formatCreditLedgerDescription('Consumed on openrouter/meta/llama-3.1-70b');

    expect(formatted).toContain('meta/llama-3.1-70b');
    expect(formatted).toContain('openrouter');
  });

  it('prefers explicit provider display names over lower-priority metadata', () => {
    const formatted = formatCreditLedgerDescription('Consumed on 757e1732-8478/deepseek-chat', {
      groupName: 'Fallback Group',
      instanceName: 'Instance Name',
      providerDisplayName: 'Displayed Provider',
    });

    expect(formatted).toContain('deepseek-chat');
    expect(formatted).toContain('Displayed Provider');
    expect(formatted).not.toContain('Fallback Group');
    expect(formatted).not.toContain('Instance Name');
  });

  it('uses the standard empty placeholder for blank or non-string descriptions', () => {
    expect(formatCreditLedgerDescription('')).toBe('--');
    expect(formatCreditLedgerDescription(null)).toBe('--');
  });
});
