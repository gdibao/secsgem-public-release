import {
  type ModuleAppPackageFileManifestItem,
  type ModuleAppPackageManifest,
  type ModuleAppPackageSubmitInput,
  type ModuleAppPackageValidationIssue,
  moduleAppPackageManifestSchema,
  moduleAppPackageSubmitSchema,
} from '@lobechat/types';

const DEFAULT_LIMITS = {
  maxFileCount: 1000,
  maxFileSizeBytes: 25 * 1024 * 1024,
  maxPackageSizeBytes: 50 * 1024 * 1024,
};

export type ModuleAppPackageValidationLimits = Partial<typeof DEFAULT_LIMITS>;

export type ModuleAppPackageValidationResult = {
  issues: ModuleAppPackageValidationIssue[];
  ok: boolean;
};

const getLimits = (limits: ModuleAppPackageValidationLimits = {}) => ({
  ...DEFAULT_LIMITS,
  ...limits,
});

const createIssue = (
  issue: Omit<ModuleAppPackageValidationIssue, 'severity'> & {
    severity?: ModuleAppPackageValidationIssue['severity'];
  },
): ModuleAppPackageValidationIssue => ({
  severity: 'error',
  ...issue,
});

const isUnsafePackagePath = (path: string) => {
  const trimmed = path.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true;
  if (trimmed.includes('\\')) return true;

  return trimmed.split('/').some((segment) => segment === '..' || segment === '');
};

export const validateModuleAppPackageFiles = (
  files: ModuleAppPackageFileManifestItem[],
  limits?: ModuleAppPackageValidationLimits,
): ModuleAppPackageValidationResult => {
  const resolvedLimits = getLimits(limits);
  const issues: ModuleAppPackageValidationIssue[] = [];

  if (files.length > resolvedLimits.maxFileCount) {
    issues.push(
      createIssue({
        code: 'module_app_package_too_many_files',
        message: `Package contains ${files.length} files, maximum is ${resolvedLimits.maxFileCount}.`,
      }),
    );
  }

  const hasLegacyManifest = files.some((file) => file.path === 'manifest.json');
  const hasExecutableManifest = files.some((file) => file.path === 'module-app.yaml');
  if (!hasLegacyManifest && !hasExecutableManifest) {
    issues.push(
      createIssue({
        code: 'module_app_package_manifest_missing',
        message: 'Package must contain one root manifest.json or module-app.yaml file.',
        path: 'manifest.json',
      }),
    );
  }
  if (hasLegacyManifest && hasExecutableManifest) {
    issues.push(
      createIssue({
        code: 'module_app_package_manifest_conflict',
        message: 'Package must not contain both manifest.json and module-app.yaml.',
      }),
    );
  }

  for (const file of files) {
    if (isUnsafePackagePath(file.path)) {
      issues.push(
        createIssue({
          code: 'module_app_package_unsafe_path',
          message: 'Package file paths must be relative POSIX paths without traversal.',
          path: file.path,
        }),
      );
    }

    if (file.sizeBytes > resolvedLimits.maxFileSizeBytes) {
      issues.push(
        createIssue({
          code: 'module_app_package_file_too_large',
          message: `Package file exceeds ${resolvedLimits.maxFileSizeBytes} bytes.`,
          path: file.path,
        }),
      );
    }
  }

  return { issues, ok: issues.every((issue) => issue.severity !== 'error') };
};

export const validateModuleAppPackageSubmission = (
  input: ModuleAppPackageSubmitInput | unknown,
  limits?: ModuleAppPackageValidationLimits,
): ModuleAppPackageValidationResult => {
  const parsed = moduleAppPackageSubmitSchema.parse(input);
  const resolvedLimits = getLimits(limits);
  const fileValidation = validateModuleAppPackageFiles(parsed.fileManifest, resolvedLimits);
  const issues = [...fileValidation.issues];

  if (parsed.archive.sizeBytes > resolvedLimits.maxPackageSizeBytes) {
    issues.push(
      createIssue({
        code: 'module_app_package_archive_too_large',
        message: `Package archive exceeds ${resolvedLimits.maxPackageSizeBytes} bytes.`,
      }),
    );
  }

  return { issues, ok: issues.every((issue) => issue.severity !== 'error') };
};

export const normalizeModuleAppPackageManifest = (
  manifest: ModuleAppPackageManifest | unknown,
) => {
  const parsed = moduleAppPackageManifestSchema.parse(manifest);

  return {
    app: parsed.app,
    entitlements: parsed.entitlements,
    packageVersion: parsed.packageVersion,
    runtime: parsed.runtime,
  };
};
