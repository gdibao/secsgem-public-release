// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getAuvTarget, normalizeBuilderArch } from './auv-binary.mjs';

describe('AUV target binary selection', () => {
  it('normalizes electron-builder architecture values', () => {
    expect(normalizeBuilderArch(1)).toBe('x64');
    expect(normalizeBuilderArch(3)).toBe('arm64');
    expect(normalizeBuilderArch('x64')).toBe('x64');
  });

  it.each([
    ['win32', 1, '@auv-js/cli-win32-x64-msvc', 'bin/auv.exe'],
    ['darwin', 1, '@auv-js/cli-darwin-x64', 'bin/auv'],
    ['darwin', 3, '@auv-js/cli-darwin-arm64', 'bin/auv'],
  ])('maps %s/%s to its target package', (platform, arch, packageName, binaryRelativePath) => {
    expect(getAuvTarget(platform, arch)).toEqual({
      binaryRelativePath,
      executable: binaryRelativePath.split('/').at(-1),
      packageName,
    });
  });

  it('fails closed for unpublished targets', () => {
    expect(() => getAuvTarget('win32', 3)).toThrow(
      'AUV does not publish an executable for win32/arm64',
    );
  });
});
