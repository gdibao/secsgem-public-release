import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(process.cwd(), 'apps/server/src/routers/lambda/moduleApp/runtime.ts'),
  'utf8',
);

describe('module app runtime dependency wiring', () => {
  it('injects every privileged runtime dependency explicitly', () => {
    for (const dependency of [
      'const artifactStorage = new FileS3()',
      'artifactStorage: {',
      'await artifactStorage.uploadBuffer(key, buffer, contentType)',
      'billing: installation.billing',
      'const creditAdapter = new ModuleAppCreditModel(ctx.serverDB)',
      'creditAdapter,',
      'outboundHosts,',
      'resolvedSecrets,',
      'serverAction: createModuleAppServerAction({ db: ctx.serverDB })',
      'workflow,',
      'workflowEngine,',
    ]) {
      expect(source).toContain(dependency);
    }
  });

  it('loads only declared installation secrets and exact manifest workflows', () => {
    expect(source).toContain('resolveModuleAppActionOutboundHosts({');
    expect(source).toContain('resolveModuleAppActionSecrets({');
    expect(source).toContain('getInstallationSecret({');
    expect(source).toContain(
      'resolveModuleAppWorkflowAction({ action, runtimeManifest: installation.runtimeManifest })',
    );
  });

  it('loads the current backend execution switch before resolving any action dependencies', () => {
    const runActionStart = source.indexOf('runAction: moduleAppProcedure');
    const runtimeConfigLoad = source.indexOf(
      'const runtimeConfig = await getServerModuleAppRuntimeConfig(ctx.serverDB)',
      runActionStart,
    );
    const executionGuard = source.indexOf(
      'if (!runtimeConfig.switches.executionEnabled)',
      runtimeConfigLoad,
    );
    const runnableAppCheck = source.indexOf('await assertRunnableApp({', runActionStart);

    expect(runActionStart).toBeGreaterThanOrEqual(0);
    expect(runtimeConfigLoad).toBeGreaterThan(runActionStart);
    expect(executionGuard).toBeGreaterThan(runtimeConfigLoad);
    expect(runnableAppCheck).toBeGreaterThan(executionGuard);
  });
});
