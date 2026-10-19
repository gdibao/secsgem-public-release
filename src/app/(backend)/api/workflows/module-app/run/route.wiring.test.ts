import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(process.cwd(), 'src/app/(backend)/api/workflows/module-app/run/route.ts'),
  'utf8',
);

describe('Module App workflow billing wiring', () => {
  it('derives AI charging exclusively from the immutable app billing mode', () => {
    expect(source).toContain('chargeAiUsage:');
    expect(source).toContain("current.detail.billing.chargeMode === 'ai_usage'");
    expect(source).toContain("current.detail.billing.chargeMode === 'hybrid'");
  });

  it('passes only administrator-reviewed general hosts to the HTTP executor', () => {
    expect(source).toContain('getModuleAppGeneralOutboundHosts');
    expect(source).toMatch(
      /outboundHosts:\s*getModuleAppGeneralOutboundHosts\(\s*current\.installation\.runtimeManifest,?\s*\)/,
    );
    expect(source).not.toContain('outboundHosts: current.runtime.outboundHosts');
  });
});
