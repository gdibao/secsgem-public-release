import { describe, expect, it } from 'vitest';

import { ModuleAppModel } from '../moduleApp';
import { ModuleAppAuditModel } from '../moduleAppAudit';
import { ModuleAppCatalogModel } from '../moduleAppCatalog';
import { ModuleAppExecutionModel } from '../moduleAppExecution';
import { ModuleAppInstallationModel } from '../moduleAppInstallation';

const owns = (model: { toString: () => string }, method: string) =>
  model.toString().includes(`${method} = async`);

describe('Module App model ownership', () => {
  it('defines each responsibility on its dedicated model layer', () => {
    expect(owns(ModuleAppCatalogModel, 'upsertAppForAdmin')).toBe(true);
    expect(owns(ModuleAppCatalogModel, 'createPackageSubmission')).toBe(true);
    expect(owns(ModuleAppCatalogModel, 'listMarketplaceApps')).toBe(true);

    expect(owns(ModuleAppInstallationModel, 'installApp')).toBe(true);
    expect(owns(ModuleAppInstallationModel, 'getRuntimeInstallationContext')).toBe(true);
    expect(owns(ModuleAppInstallationModel, 'listAdminInstalls')).toBe(true);

    expect(owns(ModuleAppExecutionModel, 'createRecord')).toBe(true);
    expect(owns(ModuleAppExecutionModel, 'createRun')).toBe(true);
    expect(owns(ModuleAppExecutionModel, 'createArtifact')).toBe(true);
    expect(owns(ModuleAppExecutionModel, 'listAdminRuns')).toBe(true);

    expect(owns(ModuleAppAuditModel, 'writeAuditLog')).toBe(true);
    expect(owns(ModuleAppAuditModel, 'listAdminAuditEvents')).toBe(true);
  });

  it('keeps the root model as the compatible final class in the ownership chain', () => {
    const model = new ModuleAppModel({} as never);

    expect(model).toBeInstanceOf(ModuleAppAuditModel);
    expect(model).toBeInstanceOf(ModuleAppExecutionModel);
    expect(model).toBeInstanceOf(ModuleAppInstallationModel);
    expect(model).toBeInstanceOf(ModuleAppCatalogModel);
    expect(typeof model.getAppDetail).toBe('function');
    expect(typeof model.getRuntimeInstallationContext).toBe('function');
    expect(typeof model.createRecord).toBe('function');
    expect(typeof model.writeAuditLog).toBe('function');
  });
});
