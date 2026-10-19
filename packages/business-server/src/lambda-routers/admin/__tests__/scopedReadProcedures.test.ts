import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readRouter = (name: string) =>
  readFileSync(path.resolve(__dirname, `../${name}.ts`), 'utf8').replaceAll(/\s+/g, ' ');

describe('scoped admin read procedures', () => {
  it('uses finance.read for finance-domain reads', () => {
    const expectations: Record<string, string[]> = {
      credits: [
        'getBalance: financeReadProcedure',
        'ledger: financeReadProcedure',
        'listAccounts: financeReadProcedure',
      ],
      orders: ['getDetail: financeReadProcedure', 'list: financeReadProcedure'],
      payments: [
        'listCreditSettlementFailures: financeReadProcedure',
        'listSubscriptionPayments: financeReadProcedure',
        'listTopUpPayments: financeReadProcedure',
      ],
      plans: ['getDeleteImpact: financeReadProcedure', 'list: financeReadProcedure'],
      subscriptions: [
        'getUserSubscription: financeReadProcedure',
        'list: financeReadProcedure',
        'listChangeRequests: financeReadProcedure',
      ],
      topupPackages: ['list: financeReadProcedure'],
    };

    for (const [router, fragments] of Object.entries(expectations)) {
      const source = readRouter(router);
      expect(source).toContain('ADMIN_CAPABILITIES.financeRead');
      for (const fragment of fragments) expect(source).toContain(fragment);
    }
  });

  it('uses read capabilities for user, model, content, audit, and system reads', () => {
    const expectations: Array<[string, string, string[]]> = [
      [
        'users',
        'ADMIN_CAPABILITIES.userRead',
        ['detail: userReadProcedure', 'exportAll: userReadProcedure'],
      ],
      [
        'newapiProviders',
        'ADMIN_CAPABILITIES.modelOpsRead',
        [
          'getInstance: modelOpsReadProcedure',
          'getDeleteInstanceImpact: modelOpsReadProcedure',
          'getRemoveModelImpact: modelOpsReadProcedure',
          'listInstances: modelOpsReadProcedure',
          'getModelCatalogDiagnostics: modelOpsReadProcedure',
          'listModels: modelOpsReadProcedure',
        ],
      ],
      [
        'content',
        'ADMIN_CAPABILITIES.contentRead',
        [
          'listDocuments: contentReadProcedure',
          'listFiles: contentReadProcedure',
          'listTopics: contentReadProcedure',
        ],
      ],
      [
        'audit-router',
        'ADMIN_CAPABILITIES.auditRead',
        ['list: auditReadProcedure', 'exportAll: auditReadProcedure'],
      ],
      [
        '../../appSettings/readers/adminProcedures',
        'ADMIN_CAPABILITIES.systemRead',
        [
          'getGovernance: systemReadProcedure',
          'getAll: systemReadProcedure',
          'validateDefaultAgentSettings: systemReadProcedure',
        ],
      ],
      ['ppt', 'ADMIN_CAPABILITIES.systemRead', ['getSettings: systemReadProcedure']],
    ];

    for (const [router, capability, fragments] of expectations) {
      const source = readRouter(router);
      expect(source).toContain(capability);
      for (const fragment of fragments) expect(source).toContain(fragment);
    }
  });

  it('uses a compact, multi-domain read surface for finance and audit user lookups', () => {
    const users = readRouter('users');

    expect(users).toContain('const compactUserReadProcedure = adminAnyCapabilityProcedure([');
    expect(users).toContain('ADMIN_CAPABILITIES.auditRead');
    expect(users).toContain('ADMIN_CAPABILITIES.financeRead');
    expect(users).toContain('ADMIN_CAPABILITIES.userRead');
    expect(users).toContain('compactDetail: compactUserReadProcedure');
    expect(users).toContain(
      'columns: { banned: true, createdAt: true, id: true, lastActiveAt: true, role: true }',
    );
  });

  it('shares only the compact enabled-model catalog with matrix read domains', () => {
    const providers = readRouter('newapiProviders');

    expect(providers).toContain('const sharedModelReadProcedure = adminAnyCapabilityProcedure([');
    expect(providers).toContain('ADMIN_CAPABILITIES.modelOpsRead');
    expect(providers).toContain('ADMIN_CAPABILITIES.financeRead');
    expect(providers).toContain('ADMIN_CAPABILITIES.systemRead');
    expect(providers).toContain('getAllEnabledModels: sharedModelReadProcedure');

    const compactProjection = providers.slice(
      providers.indexOf('getAllEnabledModels: sharedModelReadProcedure'),
    );
    expect(compactProjection).not.toContain('baseUrl: adminNewapiInstances.baseUrl');
    expect(compactProjection).not.toContain('apiKey: adminNewapiInstances.apiKey');
  });

  it('binds read wrappers to their exact capabilities', () => {
    const expectations: Array<[string, string]> = [
      ['users', 'const userReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.userRead)'],
      [
        'newapiProviders',
        'const modelOpsReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.modelOpsRead)',
      ],
      [
        'content',
        'const contentReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.contentRead)',
      ],
      [
        '../../appSettings/readers/adminProcedures',
        'const systemReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.systemRead)',
      ],
      [
        'ppt',
        'const systemReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.systemRead)',
      ],
    ];

    for (const [router, declaration] of expectations) {
      expect(readRouter(router)).toContain(declaration);
    }
  });

  it('keeps sensitive user queries scoped without write side effects', () => {
    const users = readRouter('users');

    expect(users).toContain(
      'const supportWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.supportWrite)',
    );
    expect(users).toContain('fullDetail: supportWriteProcedure');
    expect(users).toContain('list: supportWriteProcedure');
    expect(users).not.toContain('syncExpiredSubscriptionsToFree');
    expect(users).toContain("eq(userPlanSnapshots.status, 'active')");
    expect(users).toContain('isNull(userPlanSnapshots.endsAt)');
  });

  it('isolates Module App reads and edits from content administration', () => {
    const source = readRouter('moduleApps');
    const moduleAppReads = [
      'get',
      'getRuntimeDiagnostics',
      'list',
      'getPackage',
      'listArtifacts',
      'listInstalls',
      'listPackages',
      'listProducts',
      'listRecords',
      'listRuns',
    ];
    const financeReads = [
      'exportPaymentReconciliation',
      'listPaymentDiagnostics',
      'listPayouts',
      'listRevenue',
    ];
    const moduleAppWrites = [
      'assignPublisher',
      'createProduct',
      'createPublisher',
      'publish',
      'approvePackage',
      'rejectPackage',
      'rescanPackage',
      'suspendPublisher',
      'unpublish',
      'updateProduct',
      'upsert',
      'upsertConfiguration',
      'verifyPublisher',
    ];
    const financeWrites = [
      'acknowledgePaymentDiscrepancy',
      'createPayoutBatch',
      'reconcilePendingPayments',
      'recordManualAlipayPayout',
      'refundOrder',
      'refundPaymentOrder',
      'retryPaymentQuery',
      'retryRefundStatus',
      'settleOrder',
      'settleRevenueBatch',
      'transitionPayoutBatch',
      'upsertBilling',
      'upsertEntitlements',
    ];

    expect(source).toContain('ADMIN_CAPABILITIES.moduleAppRead');
    expect(source).toContain('ADMIN_CAPABILITIES.moduleAppWrite');
    for (const procedure of moduleAppReads) {
      expect(source).toContain(`${procedure}: moduleAppReadProcedure`);
    }
    expect(source).toContain('listAuditEvents: moduleAuditReadProcedure');
    expect(source).toContain('listPublishers: publisherReadProcedure');
    for (const procedure of financeReads) {
      expect(source).toContain(`${procedure}: financeReadProcedure`);
    }
    for (const procedure of moduleAppWrites) {
      expect(source).toContain(`${procedure}: moduleAppWriteProcedure`);
    }
    for (const procedure of financeWrites) {
      expect(source).toContain(`${procedure}: financeWriteProcedure`);
    }
    expect(source).not.toContain('const contentWriteProcedure =');
  });

  it('keeps side-effecting diagnostics and cache operations write-bound', () => {
    const providers = readRouter('newapiProviders');
    const settings = readRouter('../../appSettings/writers/runtimeProcedures');

    expect(providers).toContain('testInstanceConnection: modelOpsWriteProcedure');
    expect(providers).toContain('refreshRuntimeCache: modelOpsWriteProcedure');
    expect(providers).toContain('syncInstanceModels: modelOpsWriteProcedure');
    expect(settings).toContain('refreshRuntimeCaches: systemWriteProcedure');
    expect(settings).toContain('testS3Storage: systemWriteProcedure');
    expect(settings).toContain('runMaintenance: systemWriteProcedure');
  });
});
