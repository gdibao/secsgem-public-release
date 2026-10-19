import { createHash } from 'node:crypto';

import {
  DEFAULT_MODULE_APP_PACKAGE_LIMITS,
  inspectModuleAppZipEntries,
  ModuleAppPackageSafetyError,
  ModuleAppZipMetadataError,
  scanModuleAppPackage,
  unzipModuleAppPackage,
  type ModuleAppPackageArchiveLimits,
} from '@lobechat/module-app-build';
import {
  moduleAppPackageManifestV1Schema,
  moduleAppPackageManifestV2Schema,
  type ModuleAppPackageSubmitInput,
  type ModuleAppPackageValidationIssue,
} from '@lobechat/types';
import { parse as parseYaml } from 'yaml';

import { validateModuleAppPackageSubmission } from '@/business/server/module-apps/packageManifest';

const DEFAULT_LIMITS = DEFAULT_MODULE_APP_PACKAGE_LIMITS;
export type { ModuleAppPackageArchiveLimits } from '@lobechat/module-app-build';

export class ModuleAppPackageArchiveError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly issues: ModuleAppPackageValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'ModuleAppPackageArchiveError';
  }
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

export const parseModuleAppPackageArchive = async (
  input: {
    bytes: Uint8Array;
    fileName: string;
    mimeType: ModuleAppPackageSubmitInput['archive']['mimeType'];
    storageKey: string;
  },
  overrides: ModuleAppPackageArchiveLimits = {},
): Promise<ModuleAppPackageSubmitInput> => {
  const limits = { ...DEFAULT_LIMITS, ...overrides };

  if (input.bytes.byteLength === 0 || input.bytes.byteLength > limits.maxPackageSizeBytes) {
    throw new ModuleAppPackageArchiveError(
      'module_app_package_archive_too_large',
      `Package archive must be between 1 and ${limits.maxPackageSizeBytes} bytes.`,
    );
  }

  let entries;
  try {
    entries = inspectModuleAppZipEntries(input.bytes);
  } catch (error) {
    if (error instanceof ModuleAppZipMetadataError) {
      throw new ModuleAppPackageArchiveError(error.code, error.message);
    }
    throw error;
  }

  let files: Record<string, Uint8Array>;
  try {
    files = await unzipModuleAppPackage(input.bytes, limits);
  } catch (error) {
    if (error instanceof ModuleAppPackageSafetyError) {
      throw new ModuleAppPackageArchiveError(error.code, error.message, error.issues);
    }
    throw error;
  }
  const scanIssues = scanModuleAppPackage({ entries, files });
  if (scanIssues.length > 0) {
    const firstIssue = scanIssues[0];
    throw new ModuleAppPackageArchiveError(firstIssue.code, firstIssue.message, scanIssues);
  }

  const legacyManifestBytes = files['manifest.json'];
  const executableManifestBytes = files['module-app.yaml'];
  if (legacyManifestBytes && executableManifestBytes) {
    throw new ModuleAppPackageArchiveError(
      'module_app_package_manifest_conflict',
      'Package must not contain both manifest.json and module-app.yaml.',
    );
  }

  const manifestBytes = legacyManifestBytes ?? executableManifestBytes;
  const manifestPath = legacyManifestBytes ? 'manifest.json' : 'module-app.yaml';
  if (!manifestBytes) {
    throw new ModuleAppPackageArchiveError(
      'module_app_package_manifest_missing',
      'Package must contain one root manifest.json or module-app.yaml file.',
    );
  }
  if (manifestBytes.byteLength > limits.maxManifestBytes) {
    throw new ModuleAppPackageArchiveError(
      'module_app_package_manifest_too_large',
      `${manifestPath} exceeds ${limits.maxManifestBytes} bytes.`,
    );
  }

  let manifest: unknown;
  try {
    const manifestText = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
    manifest = legacyManifestBytes ? JSON.parse(manifestText) : parseYaml(manifestText);
  } catch {
    throw new ModuleAppPackageArchiveError(
      legacyManifestBytes
        ? 'module_app_package_manifest_invalid_json'
        : 'module_app_package_manifest_invalid_yaml',
      `${manifestPath} must contain valid UTF-8 ${legacyManifestBytes ? 'JSON' : 'YAML'}.`,
    );
  }

  const parsedManifest = legacyManifestBytes
    ? moduleAppPackageManifestV1Schema.safeParse(manifest)
    : moduleAppPackageManifestV2Schema.safeParse(manifest);
  if (!parsedManifest.success) {
    throw new ModuleAppPackageArchiveError(
      'module_app_package_manifest_invalid',
      `${manifestPath} does not match the Module App manifest schema.`,
    );
  }

  const submission: ModuleAppPackageSubmitInput = {
    archive: {
      fileName: input.fileName,
      mimeType: input.mimeType,
      sha256: sha256(input.bytes),
      sizeBytes: input.bytes.byteLength,
      storageKey: input.storageKey,
    },
    fileManifest: Object.entries(files)
      .map(([path, data]) => ({ path, sha256: sha256(data), sizeBytes: data.byteLength }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    manifest: parsedManifest.data,
  };
  const validation = validateModuleAppPackageSubmission(submission, {
    maxFileCount: limits.maxFileCount,
    maxFileSizeBytes: limits.maxFileSizeBytes,
    maxPackageSizeBytes: limits.maxPackageSizeBytes,
  });

  if (!validation.ok) {
    const issue = validation.issues.find(({ severity }) => severity === 'error');
    throw new ModuleAppPackageArchiveError(
      issue?.code ?? 'module_app_package_validation_failed',
      issue?.message ?? 'Package validation failed.',
    );
  }

  return submission;
};
