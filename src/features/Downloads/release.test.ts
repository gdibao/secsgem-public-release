import { describe, expect, it } from 'vitest';

import {
  CHITUO_CLI_TGZ_URL,
  CHITUO_DOWNLOADS_URL,
  CLI_HELP_COMMAND,
  CLI_HELP_OUTPUT,
  CLI_INSTALL_COMMAND,
} from './release';

describe('Chituo downloads release metadata', () => {
  it('uses the public Chituo download origin and the published CLI package', () => {
    expect(CHITUO_DOWNLOADS_URL).toBe('https://secsgem.com.cn/downloads/');
    expect(CHITUO_CLI_TGZ_URL).toMatch(
      /^https:\/\/secsgem\.com\.cn\/downloads\/v2\.2\.17-chituo\.32\/.+\.tgz$/,
    );
    expect(CLI_INSTALL_COMMAND).toBe(`npm install -g ${CHITUO_CLI_TGZ_URL}`);
  });

  it('shows the commands and identity that the published package actually exposes', () => {
    expect(CLI_HELP_COMMAND).toBe('chituo --help');
    expect(CLI_HELP_OUTPUT).toContain('Usage: chituo');
    expect(CLI_HELP_OUTPUT).toContain('Chituo AI CLI');
    expect(`${CLI_INSTALL_COMMAND}\n${CLI_HELP_COMMAND}\n${CLI_HELP_OUTPUT}`).not.toMatch(
      /@lobehub\/cli|lobehub --help|LobeHub CLI/,
    );
  });
});
