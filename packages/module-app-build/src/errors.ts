import type { ModuleAppPackageValidationIssue } from '@lobechat/types';

export type ModuleAppBuildPolicyErrorCode =
  | 'MODULE_APP_BUILD_SOURCE_ARCHIVE_REJECTED'
  | 'MODULE_APP_BUILD_SOURCE_FRONTEND_OUTPUT_MISSING'
  | 'MODULE_APP_BUILD_SOURCE_FUNCTION_OUTPUT_MISSING'
  | 'MODULE_APP_BUILD_SOURCE_HASH_MISMATCH'
  | 'MODULE_APP_BUILD_SOURCE_MANIFEST_MISMATCH'
  | 'MODULE_APP_BUILD_SOURCE_MANIFEST_REJECTED'
  | 'MODULE_APP_BUILD_SOURCE_POLICY_REJECTED';

export class ModuleAppBuildPolicyError extends Error {
  constructor(
    public readonly code: ModuleAppBuildPolicyErrorCode,
    message: string,
    public readonly issues: ModuleAppPackageValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'ModuleAppBuildPolicyError';
  }
}

export class ModuleAppPackageSafetyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly issues: ModuleAppPackageValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'ModuleAppPackageSafetyError';
  }
}
