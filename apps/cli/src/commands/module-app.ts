import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

import { MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES } from '@lobechat/types';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { startModuleAppDevServer } from '../moduleApp/devServer';
import {
  initializeModuleAppProject,
  packModuleAppProject,
  validateModuleAppProject,
} from '../moduleApp/project';
import { resolveServerUrl } from '../settings';
import { log } from '../utils/logger';

const run = async (action: () => Promise<void>) => {
  try {
    await action();
  } catch (error) {
    log.error(error instanceof Error ? error.message : 'Module App command failed.');
    process.exitCode = 1;
  }
};

export function registerModuleAppCommand(program: Command) {
  const command = program.command('module-app').description('Develop Module Apps');

  command
    .command('dev [directory]')
    .description('Preview a Module App with a local SDK bridge')
    .option('--host <host>', 'Listening host', '127.0.0.1')
    .option('--port <port>', 'Listening port', '4173')
    .action((directory = '.', options: { host: string; port: string }) =>
      run(async () => {
        const port = Number.parseInt(options.port, 10);
        if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Invalid port.');
        const server = await startModuleAppDevServer({ directory, host: options.host, port });
        console.log(`${pc.green('✓')} Module App preview: ${server.url}`);
        await new Promise<void>((resolve) => {
          const close = () => void server.close().finally(resolve);
          process.once('SIGINT', close);
          process.once('SIGTERM', close);
        });
      }),
    );

  command
    .command('init <directory>')
    .description('Create a Module App project')
    .option('--display-name <name>', 'Publisher-facing application name')
    .option('--slug <slug>', 'Marketplace slug')
    .action((directory: string, options: { displayName?: string; slug?: string }) =>
      run(async () => {
        const result = await initializeModuleAppProject({ directory, ...options });
        console.log(`${pc.green('✓')} Created ${pc.bold(result.slug)} in ${result.directory}`);
      }),
    );

  command
    .command('validate [directory]')
    .description('Validate a Module App manifest')
    .action((directory = '.') =>
      run(async () => {
        const result = await validateModuleAppProject(directory);
        console.log(
          `${pc.green('✓')} ${result.manifest.app.slug}@${result.manifest.packageVersion} is valid`,
        );
      }),
    );

  command
    .command('pack [directory]')
    .description('Validate and package a Module App')
    .option('-o, --output <file>', 'Output ZIP path')
    .action((directory = '.', options: { output?: string }) =>
      run(async () => {
        const result = await packModuleAppProject({
          directory,
          output: options.output,
          onFilesCollected: (files) => {
            console.log(pc.dim(`Including ${files.length} files:`));
            files.forEach((file) => console.log(pc.dim(`  ${file}`)));
          },
        });
        console.log(
          `${pc.green('✓')} Packed ${result.fileCount} files (${result.sizeBytes} bytes) to ${result.output}`,
        );
      }),
    );

  command
    .command('submit <package>')
    .description('Submit a packaged Module App for review')
    .option('--json', 'Print a machine-readable submission result')
    .action((packagePath: string, options: { json?: boolean }) =>
      run(async () => {
        const filePath = path.resolve(packagePath);
        if (!filePath.toLowerCase().endsWith('.zip'))
          throw new Error('Package must be a ZIP file.');
        const fileStat = await lstat(filePath);
        if (
          !fileStat.isFile() ||
          fileStat.isSymbolicLink() ||
          fileStat.size === 0 ||
          fileStat.size > MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES
        ) {
          throw new Error('Package size is outside the allowed range.');
        }
        const handle = await open(filePath, 'r');
        let bytes: Uint8Array;
        try {
          const openedStat = await handle.stat();
          if (
            !openedStat.isFile() ||
            openedStat.dev !== fileStat.dev ||
            openedStat.ino !== fileStat.ino ||
            openedStat.size !== fileStat.size
          ) {
            throw new Error('Package changed while reading.');
          }
          bytes = await handle.readFile();
          const completedStat = await handle.stat();
          if (
            bytes.byteLength !== openedStat.size ||
            completedStat.size !== openedStat.size ||
            completedStat.mtimeMs !== openedStat.mtimeMs ||
            completedStat.ctimeMs !== openedStat.ctimeMs
          ) {
            throw new Error('Package changed while reading.');
          }
        } finally {
          await handle.close();
        }
        const client = await getTrpcClient();
        const fileName = path.basename(filePath);
        const target = await client.moduleApp.createPackageUpload.mutate({
          fileName,
          mimeType: 'application/zip',
          sizeBytes: bytes.byteLength,
        });
        const response = await fetch(target.uploadUrl, {
          body: bytes,
          headers: { ...target.headers, 'Content-Type': 'application/zip' },
          method: 'PUT',
        });
        if (!response.ok) throw new Error(`Package upload failed (${response.status}).`);
        const submission = await client.moduleApp.submitUploadedPackage.mutate({
          fileName,
          storageKey: target.storageKey,
          uploadId: target.uploadId,
        });
        const statusUrl = new URL('/apps/developer', resolveServerUrl());
        statusUrl.searchParams.set('submission', submission.id);
        statusUrl.searchParams.set('tab', 'packages');
        if (options.json) {
          console.log(
            JSON.stringify({
              fileName,
              id: submission.id,
              reviewStatus: submission.reviewStatus,
              statusUrl: statusUrl.toString(),
            }),
          );
          return;
        }
        console.log(`${pc.green('✓')} Submitted ${pc.bold(fileName)} for review`);
        console.log(pc.dim(`Submission: ${submission.id}`));
        console.log(pc.dim(`Status: ${statusUrl.toString()}`));
      }),
    );
}
