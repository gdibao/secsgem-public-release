import { readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Command } from 'commander';

import { FabHarnessServer } from '../harness/server';
import { log } from '../utils/logger';

interface HarnessServeOptions {
  credentialsRoot?: string;
  dataRoot?: string;
  host?: string;
  port?: string;
  server?: string;
}

export const createFileCredentialResolver =
  (credentialsRoot: string) => async (reference: string) => {
    const match = reference.match(/^file:([\w][\w./-]{0,255})$/);
    if (!match || match[1].split('/').includes('..'))
      throw new Error('invalid_credential_reference');

    const root = await realpath(credentialsRoot);
    const target = await realpath(path.resolve(root, match[1]));
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('invalid_credential_reference');
    const secret = (await readFile(target, 'utf8')).trim();
    if (!secret) throw new Error('credential_reference_empty');
    return secret;
  };

export const registerHarnessCommand = (program: Command) => {
  program
    .command('harness')
    .description('Run the trusted Fab heterogeneous-agent harness gateway')
    .requiredOption('--server <url>', 'Fab server base URL')
    .option('--host <host>', 'Listen host', '127.0.0.1')
    .option('--port <port>', 'Listen port', '41880')
    .option('--data-root <path>', 'Private tenant runtime root')
    .option('--credentials-root <path>', 'Private file-backed runtime credential references')
    .action(async (options: HarnessServeOptions) => {
      const port = Number.parseInt(options.port ?? '', 10);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error('Invalid harness port');
      }
      const gateway = new FabHarnessServer({
        codexConfigTemplate: process.env.FAB_HARNESS_CODEX_CONFIG_TEMPLATE,
        dataRoot:
          options.dataRoot ??
          process.env.FAB_HARNESS_DATA_ROOT ??
          path.join(os.homedir(), '.chituo-ai', 'harness-runtime'),
        fabServerUrl: new URL(options.server!).toString(),
        hermesCredentialResolver:
          options.credentialsRoot || process.env.FAB_HARNESS_CREDENTIALS_ROOT
            ? createFileCredentialResolver(
                options.credentialsRoot ?? process.env.FAB_HARNESS_CREDENTIALS_ROOT!,
              )
            : undefined,
        host: options.host ?? '127.0.0.1',
        port,
      });
      await gateway.start();
      log.info(`Fab harness gateway listening on ${options.host ?? '127.0.0.1'}:${port}`);

      const close = async () => {
        await gateway.close();
        process.exit(0);
      };
      process.once('SIGINT', () => void close());
      process.once('SIGTERM', () => void close());
    });
};
