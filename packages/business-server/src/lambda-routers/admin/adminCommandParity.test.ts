import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ADMIN_COMMANDS, type AdminCapability } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

const middlewareByCapability: Record<AdminCapability, string> = {
  'admin.access': 'adminProcedure',
  'audit.read': 'auditReadProcedure',
  'content.read': 'contentReadProcedure',
  'content.write': 'contentWriteProcedure',
  'finance.read': 'financeReadProcedure',
  'finance.write': 'financeWriteProcedure',
  'modelOps.read': 'modelOpsReadProcedure',
  'modelOps.write': 'modelOpsWriteProcedure',
  'moduleApp.read': 'moduleAppReadProcedure',
  'moduleApp.write': 'moduleAppWriteProcedure',
  'support.write': 'supportWriteProcedure',
  'system.read': 'systemReadProcedure',
  'system.write': 'systemWriteProcedure',
  'user.read': 'userReadProcedure',
};

const externalEffectCommands = new Set([
  'content.deleteDocument',
  'content.deleteFile',
  'desktop.buildAsset.complete',
  'desktop.release.dispatch',
  'desktop.release.reconcile',
  'desktop.release.retry',
]);
const nestedTransactionAuditCommandNames: Record<string, string> = {
  'desktop.release.activate': 'activateDesktopReleaseCommand',
  'desktop.release.create': 'createDesktopReleaseCreationCommand',
};
const auditOnlyCommands = new Set(['user.impersonate.attempt']);

const sensitiveMutationRouters = [
  'content.ts',
  'newapiProviders.ts',
  'orders.ts',
  'plans.ts',
  'settings.ts',
  'subscriptions.ts',
  'topupPackages.ts',
  'users.ts',
];

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getProcedureSource = (procedurePath: string) => {
  const [, routerName, procedureName] = procedurePath.split('.');
  const settingsProcedureSources: Record<string, string> = {
    runMaintenance: '../../appSettings/writers/runtimeProcedures.ts',
    setAppSetting: '../../appSettings/writers/adminProcedures.ts',
  };
  const sourcePath =
    routerName === 'settings' && settingsProcedureSources[procedureName]
      ? path.resolve(__dirname, settingsProcedureSources[procedureName])
      : path.join(__dirname, `${routerName}.ts`);
  const source = readFileSync(sourcePath, 'utf8');
  const marker = `  ${procedureName}:`;
  const start = source.indexOf(marker);
  expect(start, procedurePath).toBeGreaterThanOrEqual(0);

  const nextProcedure = source.slice(start + marker.length).search(/\n {2}[A-Z]\w*:/i);
  const end = nextProcedure < 0 ? source.length : start + marker.length + nextProcedure;

  return { block: source.slice(start, end), source };
};

describe('admin command router parity', () => {
  it('wires every catalog procedure to its declared middleware and command definition', () => {
    for (const definition of Object.values(ADMIN_COMMANDS)) {
      if (definition.serverBoundary.kind !== 'trpc') continue;

      const { block, source } = getProcedureSource(definition.serverBoundary.procedurePath);
      const middleware = middlewareByCapability[definition.capability];

      expect(block, definition.actionId).toMatch(
        new RegExp(`^  [A-Za-z][A-Za-z0-9_]*: ${escapeRegExp(middleware)}`),
      );

      if (definition.confirmationMode === 'none') {
        const nestedCommandName = nestedTransactionAuditCommandNames[definition.actionId];
        if (nestedCommandName) {
          expect(source, definition.actionId).toMatch(
            new RegExp(
              `const ${nestedCommandName} = createAdminCommand\\('${escapeRegExp(definition.actionId)}'\\)`,
            ),
          );
          expect(block, definition.actionId).toContain(
            `action: ${nestedCommandName}.definition.auditAction`,
          );
          expect(block, definition.actionId).toMatch(/runRequiredAdminAuditMutation(?:<[^>]+>)?\(/);
          continue;
        }

        const commandMatch = block.match(/action: ([A-Za-z]\w*)\.definition\.auditAction/);
        expect(commandMatch, definition.actionId).not.toBeNull();

        const commandName = commandMatch![1];
        expect(source, definition.actionId).toMatch(
          new RegExp(
            `const ${commandName} = createAdminCommand\\('${escapeRegExp(definition.actionId)}'\\)`,
          ),
        );
        continue;
      }

      const schemaMatch = block.match(/command: ([A-Za-z]\w*)\.schema/);
      expect(schemaMatch, definition.actionId).not.toBeNull();

      const commandName = schemaMatch![1];
      expect(source, definition.actionId).toMatch(
        new RegExp(
          `const ${commandName} = createAdminCommand\\('${escapeRegExp(definition.actionId)}'\\)`,
        ),
      );
      if (definition.reasonPolicy !== 'none') {
        const reasonSchema = block.match(/reason:\s*z\.string\(\)[^,\n]*/);
        expect(reasonSchema, definition.actionId).not.toBeNull();
        expect(reasonSchema![0], definition.actionId).toContain('.optional()');
      }
      expect(block, definition.actionId).toContain(
        definition.reasonPolicy === 'none'
          ? `const command = ${commandName}.validate(input.command);`
          : `const command = ${commandName}.validate(input.command, input.reason);`,
      );
      expect(block, definition.actionId).toContain('action: command.auditAction');

      if (definition.severity === 'high' || definition.severity === 'critical') {
        if (externalEffectCommands.has(definition.actionId)) {
          expect(block, definition.actionId).toMatch(
            /runRequiredAdminAuditExternalEffect(?:<[^>]+>)?\(/,
          );
        } else if (!auditOnlyCommands.has(definition.actionId)) {
          expect(block, definition.actionId).toMatch(/runRequiredAdminAuditMutation(?:<[^>]+>)?\(/);
        }
      }
    }
  });

  it('rejects direct required audit calls after normal database mutation chains', () => {
    for (const routerFile of sensitiveMutationRouters) {
      const source = readFileSync(path.join(__dirname, routerFile), 'utf8');
      const procedureBlocks = source.split(/\n {2}\w+:/);

      for (const block of procedureBlocks) {
        expect(block, routerFile).not.toMatch(
          /(?:ctx\.serverDB|tx)\.(?:delete|insert|update)\([\s\S]*?await recordAdminAudit\(ctx,/,
        );
      }
    }
  });
});
