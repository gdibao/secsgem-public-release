import {
  MODULE_APP_PACKAGE_MAX_SCAN_ISSUES,
  type ModuleAppPackageValidationIssue,
} from '@lobechat/types';

import { containsModuleAppSecret, isSensitiveModuleAppPath } from './secrets';
import type { ModuleAppZipEntry } from './zipMetadata';

const FORBIDDEN_EXTENSIONS = new Set([
  '.apk',
  '.bat',
  '.cmd',
  '.com',
  '.deb',
  '.dll',
  '.dmg',
  '.dylib',
  '.exe',
  '.msi',
  '.node',
  '.pkg',
  '.ps1',
  '.rpm',
  '.sh',
  '.so',
]);

const NESTED_ARCHIVE_EXTENSIONS = new Set([
  '.7z',
  '.bz2',
  '.gz',
  '.jar',
  '.rar',
  '.tar',
  '.tgz',
  '.xz',
  '.zip',
]);

const EICAR_SIGNATURE = new TextEncoder().encode(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
);

const EXECUTABLE_MAGIC: number[][] = [
  [0x4d, 0x5a],
  [0x7f, 0x45, 0x4c, 0x46],
  [0xfe, 0xed, 0xfa, 0xce],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe],
  [0x00, 0x61, 0x73, 0x6d],
];

const NESTED_ARCHIVE_MAGIC: number[][] = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
  [0x1f, 0x8b],
  [0x42, 0x5a, 0x68],
  [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
  [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00],
  [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00],
];

const extensionOf = (path: string) => {
  const fileName = path.toLowerCase().split('/').pop() ?? '';
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot) : '';
};

const startsWith = (data: Uint8Array, prefix: number[]) =>
  data.byteLength >= prefix.length && prefix.every((value, index) => data[index] === value);

const includesBytes = (data: Uint8Array, needle: Uint8Array) => {
  if (needle.byteLength === 0 || data.byteLength < needle.byteLength) return false;

  outer: for (let offset = 0; offset <= data.byteLength - needle.byteLength; offset += 1) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (data[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }

  return false;
};

const hasNestedArchiveMagic = (data: Uint8Array) =>
  NESTED_ARCHIVE_MAGIC.some((magic) => startsWith(data, magic));

const issue = (code: string, path: string, message: string): ModuleAppPackageValidationIssue => ({
  code,
  message,
  path,
  severity: 'error',
});

export const scanModuleAppPackage = (input: {
  entries: ModuleAppZipEntry[];
  files: Record<string, Uint8Array>;
}): ModuleAppPackageValidationIssue[] => {
  const issues: ModuleAppPackageValidationIssue[] = [];
  const add = (next: ModuleAppPackageValidationIssue) => {
    if (issues.length < MODULE_APP_PACKAGE_MAX_SCAN_ISSUES) issues.push(next);
  };

  for (const entry of input.entries) {
    if (issues.length >= MODULE_APP_PACKAGE_MAX_SCAN_ISSUES) break;
    if (entry.type === 'symlink' || entry.isSymbolicLink) {
      add(
        issue(
          'module_app_package_symbolic_link',
          entry.name,
          'Symbolic links are not allowed in module app packages.',
        ),
      );
      continue;
    }
    if (entry.type === 'other') {
      add(
        issue(
          'module_app_package_non_regular_entry',
          entry.name,
          'Only regular files and directories are allowed in module app packages.',
        ),
      );
      continue;
    }
    if (entry.isEncrypted) {
      add(
        issue(
          'module_app_package_encrypted_entry',
          entry.name,
          'Encrypted ZIP entries are not allowed in module app packages.',
        ),
      );
    }
  }

  for (const [path, data] of Object.entries(input.files)) {
    if (issues.length >= MODULE_APP_PACKAGE_MAX_SCAN_ISSUES) break;
    const extension = extensionOf(path);

    if (isSensitiveModuleAppPath(path)) {
      add(
        issue(
          'module_app_package_sensitive_file',
          path,
          'Sensitive credential and private-key files are not allowed in module app packages.',
        ),
      );
      continue;
    }
    if (containsModuleAppSecret(data)) {
      add(
        issue(
          'module_app_package_secret_detected',
          path,
          'The package contains a high-confidence credential or private-key signature.',
        ),
      );
      continue;
    }

    if (NESTED_ARCHIVE_EXTENSIONS.has(extension) || hasNestedArchiveMagic(data)) {
      add(
        issue(
          'module_app_package_nested_archive',
          path,
          'Nested archives are not allowed in module app packages.',
        ),
      );
      continue;
    }
    if (FORBIDDEN_EXTENSIONS.has(extension)) {
      add(
        issue(
          'module_app_package_forbidden_extension',
          path,
          'Executable and command payloads are not allowed in module app packages.',
        ),
      );
      continue;
    }
    if (EXECUTABLE_MAGIC.some((magic) => startsWith(data, magic))) {
      add(
        issue(
          'module_app_package_executable_magic',
          path,
          'Executable binary content is not allowed in module app packages.',
        ),
      );
      continue;
    }
    if (includesBytes(data, EICAR_SIGNATURE)) {
      add(
        issue(
          'module_app_package_eicar_detected',
          path,
          'The package contains the EICAR antivirus test signature.',
        ),
      );
    }
  }

  return issues;
};
