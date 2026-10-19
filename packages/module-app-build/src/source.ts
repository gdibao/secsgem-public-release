import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES,
  moduleAppPackageManifestV2Schema,
  type ModuleAppPackageManifest,
  type ModuleAppPackageValidationIssue,
} from '@lobechat/types';
import { unzip } from 'fflate';
import { parse as parseYaml } from 'yaml';

import { ModuleAppBuildPolicyError, ModuleAppPackageSafetyError } from './errors';
import { scanModuleAppPackage } from './scanner';
import {
  inspectModuleAppZipEntries,
  ModuleAppZipMetadataError,
  type ModuleAppZipEntry,
} from './zipMetadata';

export const DEFAULT_MODULE_APP_PACKAGE_LIMITS = {
  maxCompressionRatio: 200,
  maxFileCount: 1000,
  maxFileSizeBytes: 25 * 1024 * 1024,
  maxManifestBytes: 256 * 1024,
  maxPackageSizeBytes: MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES,
  maxUncompressedBytes: 100 * 1024 * 1024,
};

export type ModuleAppPackageArchiveLimits = Partial<typeof DEFAULT_MODULE_APP_PACKAGE_LIMITS>;

export type ValidateModuleAppBuildSourceInput = {
  bytes: Uint8Array;
  expectedSourceSha256: string;
  reviewedManifest: Extract<ModuleAppPackageManifest, { manifestVersion: 2 }>;
};

export type ValidatedModuleAppBuildSource = {
  files: Record<string, Uint8Array>;
  manifest: Extract<ModuleAppPackageManifest, { manifestVersion: 2 }>;
};

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

const isUnsafePath = (path: string) => {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes('\0')) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return true;
  if (/^[a-z]:[\\/]/i.test(trimmed) || trimmed.includes('\\')) return true;

  return trimmed
    .split('/')
    .some((segment) => segment === '.' || segment === '..' || segment === '');
};

export const unzipModuleAppPackage = (
  bytes: Uint8Array,
  overrides: ModuleAppPackageArchiveLimits = {},
): Promise<Record<string, Uint8Array>> => {
  const limits = { ...DEFAULT_MODULE_APP_PACKAGE_LIMITS, ...overrides };

  return new Promise((resolve, reject) => {
    let fileCount = 0;
    let totalUncompressedBytes = 0;
    let validationError: ModuleAppPackageSafetyError | undefined;
    const seenPaths = new Set<string>();

    unzip(
      bytes,
      {
        filter: (file) => {
          if (validationError) return false;

          if (isUnsafePath(file.name)) {
            validationError = new ModuleAppPackageSafetyError(
              'module_app_package_unsafe_path',
              `Unsafe package path: ${file.name}`,
            );
            return false;
          }
          if (file.name.endsWith('/')) return false;

          if (seenPaths.has(file.name)) {
            validationError = new ModuleAppPackageSafetyError(
              'module_app_package_duplicate_path',
              `Duplicate package path: ${file.name}`,
            );
            return false;
          }
          seenPaths.add(file.name);

          fileCount += 1;
          totalUncompressedBytes += file.originalSize;

          if (fileCount > limits.maxFileCount) {
            validationError = new ModuleAppPackageSafetyError(
              'module_app_package_too_many_files',
              `Package contains more than ${limits.maxFileCount} files.`,
            );
            return false;
          }
          if (file.originalSize > limits.maxFileSizeBytes) {
            validationError = new ModuleAppPackageSafetyError(
              'module_app_package_file_too_large',
              `Package file exceeds ${limits.maxFileSizeBytes} bytes: ${file.name}`,
            );
            return false;
          }
          if (totalUncompressedBytes > limits.maxUncompressedBytes) {
            validationError = new ModuleAppPackageSafetyError(
              'module_app_package_expanded_too_large',
              `Expanded package exceeds ${limits.maxUncompressedBytes} bytes.`,
            );
            return false;
          }

          const compressionRatio =
            file.size === 0 ? file.originalSize : file.originalSize / file.size;
          if (compressionRatio > limits.maxCompressionRatio) {
            validationError = new ModuleAppPackageSafetyError(
              'module_app_package_compression_ratio_exceeded',
              `Package file compression ratio is too high: ${file.name}`,
            );
            return false;
          }

          return true;
        },
      },
      (error, files) => {
        if (validationError) return reject(validationError);
        if (error) {
          return reject(
            new ModuleAppPackageSafetyError(
              'module_app_package_archive_invalid',
              'Package archive could not be decompressed.',
            ),
          );
        }

        resolve(files);
      },
    );
  });
};

const assertNoScanIssues = (issues: ModuleAppPackageValidationIssue[]) => {
  if (issues.length === 0) return;

  throw new ModuleAppBuildPolicyError(
    'MODULE_APP_BUILD_SOURCE_POLICY_REJECTED',
    issues[0].message,
    issues,
  );
};

const parseSingleRootV2Manifest = (
  files: Record<string, Uint8Array>,
): Extract<ModuleAppPackageManifest, { manifestVersion: 2 }> => {
  const manifestBytes = files['module-app.yaml'];
  if (!manifestBytes || files['manifest.json']) {
    throw new ModuleAppBuildPolicyError(
      'MODULE_APP_BUILD_SOURCE_MANIFEST_REJECTED',
      'Build source must contain exactly one root module-app.yaml manifest v2.',
    );
  }
  if (manifestBytes.byteLength > DEFAULT_MODULE_APP_PACKAGE_LIMITS.maxManifestBytes) {
    throw new ModuleAppBuildPolicyError(
      'MODULE_APP_BUILD_SOURCE_MANIFEST_REJECTED',
      `module-app.yaml exceeds ${DEFAULT_MODULE_APP_PACKAGE_LIMITS.maxManifestBytes} bytes.`,
    );
  }

  let manifest: unknown;
  try {
    const manifestText = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
    manifest = parseYaml(manifestText);
  } catch {
    throw new ModuleAppBuildPolicyError(
      'MODULE_APP_BUILD_SOURCE_MANIFEST_REJECTED',
      'module-app.yaml must contain valid UTF-8 YAML.',
    );
  }

  const parsed = moduleAppPackageManifestV2Schema.safeParse(manifest);
  if (!parsed.success) {
    throw new ModuleAppBuildPolicyError(
      'MODULE_APP_BUILD_SOURCE_MANIFEST_REJECTED',
      'module-app.yaml does not match the Module App manifest v2 schema.',
    );
  }

  return parsed.data;
};

const assertDeclaredOutputs = (
  files: Record<string, Uint8Array>,
  entries: ModuleAppZipEntry[],
  manifest: Extract<ModuleAppPackageManifest, { manifestVersion: 2 }>,
) => {
  const entryTypes = new Map(entries.map((entry) => [entry.name, entry.type]));
  const frontendOutput = manifest.build.frontend.output;
  const frontendFile = frontendOutput.toLowerCase().endsWith('.html')
    ? frontendOutput
    : `${frontendOutput}/index.html`;

  if (!files[frontendFile] || entryTypes.get(frontendFile) !== 'regular') {
    throw new ModuleAppBuildPolicyError(
      'MODULE_APP_BUILD_SOURCE_FRONTEND_OUTPUT_MISSING',
      `Declared frontend output is missing: ${frontendFile}`,
    );
  }

  for (const runtimeFunction of manifest.runtime.functions) {
    if (!files[runtimeFunction.entry] || entryTypes.get(runtimeFunction.entry) !== 'regular') {
      throw new ModuleAppBuildPolicyError(
        'MODULE_APP_BUILD_SOURCE_FUNCTION_OUTPUT_MISSING',
        `Declared ${runtimeFunction.runtime} function entry is missing: ${runtimeFunction.entry}`,
      );
    }
  }
};

const inspectEntries = (bytes: Uint8Array): ModuleAppZipEntry[] => {
  try {
    return inspectModuleAppZipEntries(bytes);
  } catch (error) {
    if (error instanceof ModuleAppZipMetadataError) {
      throw new ModuleAppBuildPolicyError(
        'MODULE_APP_BUILD_SOURCE_ARCHIVE_REJECTED',
        error.message,
      );
    }
    throw error;
  }
};

export const validateModuleAppBuildSource = async (
  input: ValidateModuleAppBuildSourceInput,
): Promise<ValidatedModuleAppBuildSource> => {
  if (sha256(input.bytes) !== input.expectedSourceSha256.toLowerCase()) {
    throw new ModuleAppBuildPolicyError(
      'MODULE_APP_BUILD_SOURCE_HASH_MISMATCH',
      'Build source SHA-256 does not match the reviewed archive.',
    );
  }
  if (
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > DEFAULT_MODULE_APP_PACKAGE_LIMITS.maxPackageSizeBytes
  ) {
    throw new ModuleAppBuildPolicyError(
      'MODULE_APP_BUILD_SOURCE_ARCHIVE_REJECTED',
      `Build source archive must be between 1 and ${DEFAULT_MODULE_APP_PACKAGE_LIMITS.maxPackageSizeBytes} bytes.`,
    );
  }

  const entries = inspectEntries(input.bytes);
  assertNoScanIssues(scanModuleAppPackage({ entries, files: {} }));

  let files: Record<string, Uint8Array>;
  try {
    files = await unzipModuleAppPackage(input.bytes);
  } catch (error) {
    if (error instanceof ModuleAppPackageSafetyError) {
      throw new ModuleAppBuildPolicyError(
        'MODULE_APP_BUILD_SOURCE_ARCHIVE_REJECTED',
        error.message,
        error.issues,
      );
    }
    throw error;
  }

  assertNoScanIssues(scanModuleAppPackage({ entries: [], files }));
  const parsedManifest = parseSingleRootV2Manifest(files);
  try {
    assert.deepStrictEqual(parsedManifest, input.reviewedManifest);
  } catch {
    throw new ModuleAppBuildPolicyError(
      'MODULE_APP_BUILD_SOURCE_MANIFEST_MISMATCH',
      'Build source manifest does not match the reviewed manifest snapshot.',
    );
  }
  assertDeclaredOutputs(files, entries, parsedManifest);

  return { files, manifest: parsedManifest };
};
