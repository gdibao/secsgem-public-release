import { router } from '@/libs/trpc/lambda';

import { adminAuditRouter } from './audit-router';
import { adminContentRouter } from './content';
import { adminCreditsRouter } from './credits';
import { adminDesktopRouter } from './desktop';
import { adminModuleAppsRouter } from './moduleApps';
import { adminNewapiProvidersRouter } from './newapiProviders';
import { adminOrdersRouter } from './orders';
import { adminPaymentsRouter } from './payments';
import { adminPlansRouter } from './plans';
import { adminPptRouter } from './ppt';
import { adminRedemptionRouter } from './redemption';
import { adminReferralRouter } from './referral';
import { adminSettingsRouter } from './settings';
import { adminStatsRouter } from './stats';
import { adminSubscriptionsRouter } from './subscriptions';
import { adminTopUpPackagesRouter } from './topupPackages';
import { adminUsersRouter } from './users';

export const adminRouter = router({
  audit: adminAuditRouter,
  content: adminContentRouter,
  credits: adminCreditsRouter,
  desktop: adminDesktopRouter,
  moduleApps: adminModuleAppsRouter,
  newapiProviders: adminNewapiProvidersRouter,
  orders: adminOrdersRouter,
  payments: adminPaymentsRouter,
  plans: adminPlansRouter,
  ppt: adminPptRouter,
  referral: adminReferralRouter,
  redemption: adminRedemptionRouter,
  settings: adminSettingsRouter,
  stats: adminStatsRouter,
  subscriptions: adminSubscriptionsRouter,
  topupPackages: adminTopUpPackagesRouter,
  users: adminUsersRouter,
});
