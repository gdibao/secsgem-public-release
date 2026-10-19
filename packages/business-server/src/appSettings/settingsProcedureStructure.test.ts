import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, relativePath), 'utf8');

const procedureKeys = (source: string, procedureObjectName: string) => {
  const procedureObjectStart = source.indexOf(`export const ${procedureObjectName} = {`);
  const procedureObjectEnd = source.indexOf('} as const;', procedureObjectStart);

  return Array.from(
    source.slice(procedureObjectStart, procedureObjectEnd).matchAll(/^\s{2}([A-Z][A-Z0-9]+):/gim),
    ([, key]) => key,
  );
};

describe('admin settings procedure ownership', () => {
  it('keeps the legacy router as procedure composition only', () => {
    const router = readSource('../lambda-routers/admin/settings.ts');

    expect(router.split(/\r?\n/)).toHaveLength(24);
    expect(router).toContain('...publicSettingsProcedures');
    expect(router).toContain('...adminSettingsReadProcedures');
    expect(router).toContain('...adminSettingsWriteProcedures');
    expect(router).toContain('...runtimeSettingsWriteProcedures');
    expect(router).toContain('...mobilePublicationReadProcedures');
    expect(router).toContain('...mobilePublicationWriteProcedures');
    expect(router).not.toContain('ctx.serverDB');
    expect(router).not.toContain('runMaintenanceCommand');
    expect(router).not.toContain('new S3');
    expect(router).toContain('validateDefaultAgentModelUsability');
    expect(router).toContain('buildUserGlobalSettingsSyncValues');
    expect(router).toContain('syncUserGlobalSettingsDefaultsToUserSettings');
    expect(router).toContain("from '../../appSettings/procedureShared'");
    expect(router).toContain("from '../../appSettings/writers/adminProcedures'");
  });

  it('places reads, setting writes, and runtime operations in owned modules', () => {
    const publicReads = readSource('readers/publicProcedures.ts');
    const adminReads = readSource('readers/adminProcedures.ts');
    const adminWrites = readSource('writers/adminProcedures.ts');
    const runtimeWrites = readSource('writers/runtimeProcedures.ts');
    const mobileReads = readSource('readers/mobilePublicationProcedures.ts');
    const mobileWrites = readSource('writers/mobilePublicationProcedures.ts');

    expect(publicReads).toContain('getPublicBrand: publicDbProcedure');
    expect(adminReads).toContain('getSection: settingsSectionReadProcedure');
    expect(adminReads).toContain('...(await buildAdminSettingsSectionReadModel(');
    expect(adminReads).toContain('...(await buildAdminSettingsReadModel(');
    expect(adminReads).not.toContain('...buildAdminSettingsSectionReadModel(');
    expect(adminReads).not.toContain('...buildAdminSettingsReadModel(');
    expect(adminWrites).toContain('setAppSettingsBatch: settingsWriteProcedure');
    expect(runtimeWrites).toContain('testS3Storage: systemWriteProcedure');
    expect(runtimeWrites).toContain('runMaintenance: systemWriteProcedure');

    const keys = [
      procedureKeys(publicReads, 'publicSettingsProcedures'),
      procedureKeys(adminReads, 'adminSettingsReadProcedures'),
      procedureKeys(adminWrites, 'adminSettingsWriteProcedures'),
      procedureKeys(runtimeWrites, 'runtimeSettingsWriteProcedures'),
      procedureKeys(mobileReads, 'mobilePublicationReadProcedures'),
      procedureKeys(mobileWrites, 'mobilePublicationWriteProcedures'),
    ].flat();

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.toSorted()).toEqual(
      [
        'deleteUnknownSetting',
        'getAll',
        'getGovernance',
        'getPublicAboutLinks',
        'getPublicAboutPage',
        'getPublicBrand',
        'getPublicDesktopUpdate',
        'getPublicExpertPlaza',
        'getPublicGrowth',
        'getPublicHelpMenu',
        'getPublicMobileConfig',
        'getPublicMobileConfigSnapshot',
        'getPublicNotificationConfig',
        'getPublicOperations',
        'getPublicProfileOptions',
        'getPublicRecommendations',
        'getSection',
        'getMobileConfigPublication',
        'publishMobileConfig',
        'refreshRuntimeCaches',
        'runMaintenance',
        'rollbackMobileConfig',
        'saveMobileConfigDraft',
        'setAppSetting',
        'setAppSettingsBatch',
        'syncRuntimeMemoryModelsToUsers',
        'syncUserGlobalSettingsDefaultsToUsers',
        'testS3Storage',
        'validateDefaultAgentSettings',
      ].toSorted(),
    );
  });
});
