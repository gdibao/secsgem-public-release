import { describe, expect, it } from 'vitest';

import { ADMIN_CAPABILITIES } from './admin';
import { ADMIN_COMMANDS, getAdminCommandDefinition } from './adminCommand';

const trpcBoundary = (procedurePath: string) => ({ kind: 'trpc', procedurePath });

const expectedCommands = {
  'content.deleteDocument': {
    auditAction: 'content.document.delete',
    capability: ADMIN_CAPABILITIES.contentWrite,
    confirmationMode: 'confirm',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.content.deleteDocument'),
  },
  'content.deleteFile': {
    auditAction: 'content.file.delete',
    capability: ADMIN_CAPABILITIES.contentWrite,
    confirmationMode: 'confirm',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.content.deleteFile'),
  },
  'content.deleteTopic': {
    auditAction: 'content.topic.delete',
    capability: ADMIN_CAPABILITIES.contentWrite,
    confirmationMode: 'confirm',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.content.deleteTopic'),
  },
  'credits.adjust': {
    auditAction: 'credits.adjust',
    capability: ADMIN_CAPABILITIES.financeWrite,
    confirmationMode: 'typed',
    reasonPolicy: 'required',
    serverBoundary: trpcBoundary('admin.credits.adjust'),
  },
  'desktop.buildAsset.complete': {
    auditAction: 'desktop.buildAsset.complete',
    capability: ADMIN_CAPABILITIES.systemWrite,
    confirmationMode: 'none',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.desktop.completeBuildAssetUpload'),
    severity: 'high',
  },
  'desktop.buildProfile.archive': {
    auditAction: 'desktop.buildProfile.archive',
    capability: ADMIN_CAPABILITIES.systemWrite,
    confirmationMode: 'none',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.desktop.archiveBuildProfile'),
    severity: 'high',
  },
  'desktop.buildProfile.saveDraft': {
    auditAction: 'desktop.buildProfile.saveDraft',
    capability: ADMIN_CAPABILITIES.systemWrite,
    confirmationMode: 'none',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.desktop.saveBuildProfileDraft'),
    severity: 'high',
  },
  'desktop.release.create': {
    auditAction: 'desktop.release.create',
    capability: ADMIN_CAPABILITIES.systemWrite,
    confirmationMode: 'none',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.desktop.createDesktopRelease'),
    severity: 'high',
  },
  'desktop.release.activate': {
    auditAction: 'desktop.release.activate',
    capability: ADMIN_CAPABILITIES.systemWrite,
    confirmationMode: 'none',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.desktop.activateDesktopRelease'),
    severity: 'high',
  },
  'desktop.release.dispatch': {
    auditAction: 'desktop.release.dispatch',
    capability: ADMIN_CAPABILITIES.systemWrite,
    confirmationMode: 'none',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.desktop.createDesktopRelease'),
    severity: 'high',
  },
  'desktop.release.reconcile': {
    auditAction: 'desktop.release.reconcile',
    capability: ADMIN_CAPABILITIES.systemWrite,
    confirmationMode: 'none',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.desktop.reconcileDesktopRelease'),
    severity: 'high',
  },
  'desktop.release.retry': {
    auditAction: 'desktop.release.retry',
    capability: ADMIN_CAPABILITIES.systemWrite,
    confirmationMode: 'none',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.desktop.retryDesktopRelease'),
    severity: 'high',
  },
  'newapiProvider.deleteInstance': {
    auditAction: 'newapiInstance.delete',
    capability: ADMIN_CAPABILITIES.modelOpsWrite,
    confirmationMode: 'typed',
    reasonPolicy: 'required',
    serverBoundary: trpcBoundary('admin.newapiProviders.deleteInstance'),
  },
  'order.cancel': {
    auditAction: 'order.cancel',
    capability: ADMIN_CAPABILITIES.financeWrite,
    confirmationMode: 'confirm',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.orders.cancel'),
  },
  'order.expire': {
    auditAction: 'order.expire',
    capability: ADMIN_CAPABILITIES.financeWrite,
    confirmationMode: 'confirm',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.orders.expire'),
  },
  'order.settle': {
    auditAction: 'order.settle',
    capability: ADMIN_CAPABILITIES.financeWrite,
    confirmationMode: 'typed',
    reasonPolicy: 'required',
    serverBoundary: trpcBoundary('admin.orders.settle'),
  },
  'redemption.bulkDelete': {
    auditAction: 'redemption.bulkDelete',
    capability: ADMIN_CAPABILITIES.financeWrite,
    confirmationMode: 'typed',
    reasonPolicy: 'required',
    serverBoundary: trpcBoundary('admin.redemption.bulkDelete'),
  },
  'redemption.bulkDisable': {
    auditAction: 'redemption.bulkDisable',
    capability: ADMIN_CAPABILITIES.financeWrite,
    confirmationMode: 'confirm',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.redemption.bulkDisable'),
  },
  'setting.runMaintenance': {
    auditAction: 'maintenance.run',
    capability: ADMIN_CAPABILITIES.systemWrite,
    confirmationMode: 'confirm',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.settings.runMaintenance'),
  },
  'setting.setAppSetting': {
    auditAction: 'settings.set',
    capability: ADMIN_CAPABILITIES.systemWrite,
    confirmationMode: 'none',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.settings.setAppSetting'),
  },
  'subscription.changeRequest.bulkApprove': {
    auditAction: 'subscription.changeRequest.bulkApprove',
    capability: ADMIN_CAPABILITIES.financeWrite,
    confirmationMode: 'confirm',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.subscriptions.bulkApproveChangeRequests'),
  },
  'subscription.changeRequest.bulkReject': {
    auditAction: 'subscription.changeRequest.bulkReject',
    capability: ADMIN_CAPABILITIES.financeWrite,
    confirmationMode: 'confirm',
    reasonPolicy: 'optional',
    serverBoundary: trpcBoundary('admin.subscriptions.bulkRejectChangeRequests'),
  },
  'user.impersonate.attempt': {
    auditAction: 'user.impersonate.attempt',
    capability: ADMIN_CAPABILITIES.adminAccess,
    confirmationMode: 'confirm',
    reasonPolicy: 'none',
    serverBoundary: {
      kind: 'http',
      method: 'POST',
      path: '/api/auth/admin/impersonate-user',
    },
  },
  'user.resetAllToFreePlan': {
    auditAction: 'user.resetAllToFreePlan',
    capability: ADMIN_CAPABILITIES.adminAccess,
    confirmationMode: 'typed',
    reasonPolicy: 'required',
    serverBoundary: trpcBoundary('admin.users.resetAllToFreePlan'),
  },
  'user.setRole': {
    auditAction: 'user.setRole',
    capability: ADMIN_CAPABILITIES.adminAccess,
    confirmationMode: 'confirm',
    reasonPolicy: 'none',
    serverBoundary: trpcBoundary('admin.users.setRole'),
  },
} as const;

describe('ADMIN_COMMANDS', () => {
  it('defines the exact compatibility, audit, capability, and procedure contract', () => {
    expect(Object.keys(ADMIN_COMMANDS)).toEqual(Object.keys(expectedCommands));

    for (const [actionId, expected] of Object.entries(expectedCommands)) {
      expect(getAdminCommandDefinition(actionId), actionId).toMatchObject({
        actionId,
        ...expected,
        description: expect.any(String),
        severity:
          'severity' in expected
            ? expected.severity
            : expect.stringMatching(/^(medium|high|critical)$/),
        title: expect.any(String),
      });
    }
  });

  it('keeps compatibility IDs and server boundaries unique', () => {
    const definitions = Object.values(ADMIN_COMMANDS);
    const boundaryKeys = definitions.map(({ serverBoundary }) =>
      serverBoundary.kind === 'trpc'
        ? `trpc:${serverBoundary.procedurePath}`
        : `http:${serverBoundary.method}:${serverBoundary.path}`,
    );

    expect(new Set(definitions.map(({ actionId }) => actionId)).size).toBe(definitions.length);
    const duplicateBoundaryKeys = [...new Set(boundaryKeys)].filter(
      (key) => boundaryKeys.filter((candidate) => candidate === key).length > 1,
    );
    expect(duplicateBoundaryKeys).toEqual(['trpc:admin.desktop.createDesktopRelease']);
    expect(ADMIN_COMMANDS['user.impersonate.attempt'].serverBoundary).toEqual({
      kind: 'http',
      method: 'POST',
      path: '/api/auth/admin/impersonate-user',
    });
  });

  it('uses valid capabilities and coherent confirmation and reason policies', () => {
    const capabilities = new Set(Object.values(ADMIN_CAPABILITIES));

    for (const definition of Object.values(ADMIN_COMMANDS)) {
      expect(capabilities.has(definition.capability)).toBe(true);
      expect(definition.confirmationMode === 'none' && definition.reasonPolicy !== 'none').toBe(
        false,
      );
      expect(definition.confirmationMode === 'typed').toBe(definition.severity === 'critical');
    }
  });
});
