import { describe, expect, it } from 'vitest';

import { SETTINGS_SUBTITLE } from './adminSettingsCopy';

describe('adminSettingsCopy', () => {
  it('uses current admin module names in the settings page guidance', () => {
    expect(SETTINGS_SUBTITLE).toContain('品牌');
    expect(SETTINGS_SUBTITLE).toContain('默认助手外观');
    expect(SETTINGS_SUBTITLE).toContain('文件存储');
    expect(SETTINGS_SUBTITLE).toContain('系统维护');
    expect(SETTINGS_SUBTITLE).toContain('客户端');
    expect(SETTINGS_SUBTITLE).toContain('增长和计费');
    expect(SETTINGS_SUBTITLE).not.toContain('全局计费设置');
    expect(SETTINGS_SUBTITLE).not.toContain('客户端入口和维护任务');
  });
});
