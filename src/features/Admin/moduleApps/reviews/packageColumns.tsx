import type {
  ModuleAppBuildStatus,
  ModuleAppPackageReviewStatus,
  ModuleAppPackageScanStatus,
} from '@lobechat/types';
import type { ReactNode } from 'react';

import type { AdminModuleAppPackageRow } from '../types';

const formatDate = (value?: Date | string) => {
  if (!value) return '-';

  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
};

const REVIEW_STATUS_TRANSLATION_KEYS = {
  approved: 'moduleApps.admin.reviews.status.approved',
  pending_review: 'moduleApps.admin.reviews.status.pendingReview',
  rejected: 'moduleApps.admin.reviews.status.rejected',
} as const satisfies Record<ModuleAppPackageReviewStatus, string>;

const SCAN_STATUS_TRANSLATION_KEYS = {
  blocked: 'moduleApps.admin.reviews.scanStatus.blocked',
  clean: 'moduleApps.admin.reviews.scanStatus.clean',
  error: 'moduleApps.admin.reviews.scanStatus.error',
  pending: 'moduleApps.admin.reviews.scanStatus.pending',
} as const satisfies Record<ModuleAppPackageScanStatus, string>;

const BUILD_STATUS_TRANSLATION_KEYS = {
  building: 'moduleApps.admin.reviews.buildStatus.building',
  failed: 'moduleApps.admin.reviews.buildStatus.failed',
  queued: 'moduleApps.admin.reviews.buildStatus.queued',
  ready: 'moduleApps.admin.reviews.buildStatus.ready',
} as const satisfies Record<ModuleAppBuildStatus, string>;

type PackageStatusTranslationKey =
  | (typeof REVIEW_STATUS_TRANSLATION_KEYS)[keyof typeof REVIEW_STATUS_TRANSLATION_KEYS]
  | (typeof SCAN_STATUS_TRANSLATION_KEYS)[keyof typeof SCAN_STATUS_TRANSLATION_KEYS]
  | (typeof BUILD_STATUS_TRANSLATION_KEYS)[keyof typeof BUILD_STATUS_TRANSLATION_KEYS];

type PackageColumnTitle =
  | 'moduleApps.admin.reviews.columns.app'
  | 'moduleApps.admin.reviews.columns.buildStatus'
  | 'moduleApps.admin.reviews.columns.reviewStatus'
  | 'moduleApps.admin.reviews.columns.scanStatus'
  | 'moduleApps.admin.reviews.columns.submitted'
  | 'moduleApps.admin.reviews.columns.submitter'
  | 'moduleApps.admin.reviews.columns.version';

export type PackageColumn = {
  render?: (row: AdminModuleAppPackageRow) => ReactNode;
  title: PackageColumnTitle;
};

export const getPackageColumns = (
  translate: (key: PackageStatusTranslationKey) => ReactNode,
): PackageColumn[] => [
  {
    render: (row) => row.manifestSnapshot?.app?.displayName ?? '-',
    title: 'moduleApps.admin.reviews.columns.app',
  },
  {
    render: (row) => row.manifestSnapshot?.packageVersion ?? '-',
    title: 'moduleApps.admin.reviews.columns.version',
  },
  {
    render: (row) => translate(REVIEW_STATUS_TRANSLATION_KEYS[row.reviewStatus]),
    title: 'moduleApps.admin.reviews.columns.reviewStatus',
  },
  {
    render: (row) => translate(SCAN_STATUS_TRANSLATION_KEYS[row.scanStatus]),
    title: 'moduleApps.admin.reviews.columns.scanStatus',
  },
  {
    render: (row) =>
      row.buildStatus ? translate(BUILD_STATUS_TRANSLATION_KEYS[row.buildStatus]) : '-',
    title: 'moduleApps.admin.reviews.columns.buildStatus',
  },
  {
    render: (row) => row.submittedByUserId ?? '-',
    title: 'moduleApps.admin.reviews.columns.submitter',
  },
  {
    render: (row) => formatDate(row.createdAt),
    title: 'moduleApps.admin.reviews.columns.submitted',
  },
];
