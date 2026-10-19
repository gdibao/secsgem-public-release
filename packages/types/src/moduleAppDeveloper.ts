import { z } from 'zod';

import type {
  ModuleAppPackageReviewStatus,
  ModuleAppPackageScanStatus,
  ModuleAppPackageValidationIssue,
  ModuleAppStatus,
} from './moduleApp';
import type { ModuleAppPayoutStatus, ModuleAppPublisherStatus } from './moduleAppPublisher';
import type { ModuleAppBuildStatus } from './moduleAppRuntime';

export const moduleAppPublisherProfileInputSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
});
export type ModuleAppPublisherProfileInput = z.infer<typeof moduleAppPublisherProfileInputSchema>;

export const moduleAppDeveloperListInputSchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ModuleAppDeveloperListInput = z.input<typeof moduleAppDeveloperListInputSchema>;

export const moduleAppDeveloperAppInputSchema = z.object({ appId: z.string().uuid() });
export type ModuleAppDeveloperAppInput = z.infer<typeof moduleAppDeveloperAppInputSchema>;

export const moduleAppDeveloperVersionInputSchema = moduleAppDeveloperAppInputSchema.extend({
  versionId: z.string().uuid(),
});
export type ModuleAppDeveloperVersionInput = z.infer<typeof moduleAppDeveloperVersionInputSchema>;

export type ModuleAppDeveloperPublisherProfile = {
  createdAt: Date | string;
  displayName: string;
  id: string;
  status: ModuleAppPublisherStatus;
  updatedAt: Date | string;
  verifiedAt: Date | null | string;
};

export type ModuleAppDeveloperMetrics = {
  activeInstallations: number;
  failedRuns30d: number;
  successfulRuns30d: number;
  totalRuns30d: number;
};

export type ModuleAppDeveloperBuildSummary = {
  failureCode: null | string;
  status: ModuleAppBuildStatus;
};

export type ModuleAppDeveloperPackageSummary = {
  appDisplayName: string;
  appId: null | string;
  appSlug: string;
  build: ModuleAppDeveloperBuildSummary | null;
  createdAt: Date | string;
  fileName: string;
  id: string;
  packageVersion: string;
  publishedAt: Date | null | string;
  rejectionReason: null | string;
  reviewStatus: ModuleAppPackageReviewStatus;
  scanStatus: ModuleAppPackageScanStatus;
  validationReport: ModuleAppPackageValidationIssue[];
};

export type ModuleAppDeveloperAppSummary = {
  currentPublishedVersion: null | { id: string; version: string };
  displayName: string;
  id: string;
  latestPackage: ModuleAppDeveloperPackageSummary | null;
  latestVersion: null | { id: string; publishedAt: Date | null | string; version: string };
  metrics: ModuleAppDeveloperMetrics;
  slug: string;
  status: ModuleAppStatus;
  updatedAt: Date | string;
};

export type ModuleAppDeveloperAppListResult = {
  items: ModuleAppDeveloperAppSummary[];
  nextCursor: null | number;
};

export type ModuleAppDeveloperVersionSummary = {
  build: ModuleAppDeveloperBuildSummary | null;
  createdAt: Date | string;
  current: boolean;
  id: string;
  publishedAt: Date | null | string;
  version: string;
};

export type ModuleAppDeveloperSubmissionListResult = {
  items: ModuleAppDeveloperPackageSummary[];
  nextCursor: null | number;
};

export type ModuleAppDeveloperRevenueSummary = {
  currency: string;
  pendingAmount: number;
  settledAmount: number;
  totalAmount: number;
};

export type ModuleAppDeveloperRevenueEntry = {
  appId: string;
  createdAt: Date | string;
  currency: string;
  developerAmount: number;
  id: string;
  status: 'pending' | 'reversed' | 'settled';
  type: string;
};

export type ModuleAppDeveloperPayout = {
  createdAt: Date | string;
  currency: string;
  id: string;
  paidAt: Date | null | string;
  recipientMask: null | string;
  status: ModuleAppPayoutStatus;
  totalAmount: number;
};

export type ModuleAppDeveloperRevenueListResult = {
  items: ModuleAppDeveloperRevenueEntry[];
  nextCursor: null | number;
};

export type ModuleAppDeveloperPayoutListResult = {
  items: ModuleAppDeveloperPayout[];
  nextCursor: null | number;
};

export type ModuleAppDeveloperFinance = {
  payouts: ModuleAppDeveloperPayout[];
  revenue: ModuleAppDeveloperRevenueEntry[];
  summary: ModuleAppDeveloperRevenueSummary[];
};
