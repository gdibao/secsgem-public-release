import { Plans } from '@lobechat/types';
import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

import { LobeChatDatabase } from '@/database/type';
import { getServerDB } from '@/database/server';
import { planCatalog, topUpPackages } from '@/database/schemas';

const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config());
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` }));
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` }));

const CREDITS_PER_DOLLAR = 1_000_000;

const PLANS = [
  {
    currency: 'USD',
    displayName: 'Free',
    features: ['Limited model access', 'Community support'],
    isActive: true,
    monthlyCredits: 0,
    monthlyPrice: 0,
    plan: Plans.Free as string,
    sortOrder: 0,
    yearlyPrice: 0,
  },
  {
    currency: 'USD',
    displayName: 'Hobby',
    features: ['Basic models', 'Email support'],
    isActive: true,
    monthlyCredits: 0,
    monthlyPrice: 0,
    plan: Plans.Hobby as string,
    sortOrder: 1,
    yearlyPrice: 0,
  },
  {
    currency: 'USD',
    displayName: 'Starter',
    features: ['600 credits/month', 'All standard models', 'Priority support'],
    isActive: true,
    monthlyCredits: 600 * CREDITS_PER_DOLLAR,
    monthlyPrice: 19.9,
    plan: Plans.Starter as string,
    sortOrder: 2,
    yearlyPrice: 199,
  },
  {
    currency: 'USD',
    displayName: 'Premium',
    features: ['2,200 credits/month', 'Premium models', 'Top-up enabled'],
    isActive: true,
    monthlyCredits: 2200 * CREDITS_PER_DOLLAR,
    monthlyPrice: 59,
    plan: Plans.Premium as string,
    sortOrder: 3,
    yearlyPrice: 590,
  },
  {
    currency: 'USD',
    displayName: 'Ultimate',
    features: ['7,200 credits/month', 'All models', 'Dedicated support'],
    isActive: true,
    monthlyCredits: 7200 * CREDITS_PER_DOLLAR,
    monthlyPrice: 149,
    plan: Plans.Ultimate as string,
    sortOrder: 4,
    yearlyPrice: 1490,
  },
];

const PACKAGES = [
  {
    amount: 9.9,
    credits: 100 * CREDITS_PER_DOLLAR,
    currency: 'USD',
    displayName: 'Starter Pack',
    id: 'starter',
    isActive: true,
    recommended: false,
    sortOrder: 0,
    validityMonths: 12,
  },
  {
    amount: 27,
    credits: 300 * CREDITS_PER_DOLLAR,
    currency: 'USD',
    displayName: 'Growth Pack',
    id: 'growth',
    isActive: true,
    recommended: true,
    sortOrder: 1,
    validityMonths: 12,
  },
  {
    amount: 68,
    credits: 800 * CREDITS_PER_DOLLAR,
    currency: 'USD',
    displayName: 'Scale Pack',
    id: 'scale',
    isActive: true,
    recommended: false,
    sortOrder: 2,
    validityMonths: 12,
  },
];

const seed = async (db: LobeChatDatabase) => {
  console.log('Seeding plan_catalog...');
  for (const p of PLANS) {
    await db
      .insert(planCatalog)
      .values(p)
      .onConflictDoUpdate({
        set: { ...p, updatedAt: new Date() },
        target: planCatalog.plan,
      });
    console.log(`  ✓ ${p.plan} (${p.displayName})`);
  }

  console.log('Seeding topup_packages...');
  for (const pkg of PACKAGES) {
    await db
      .insert(topUpPackages)
      .values(pkg)
      .onConflictDoUpdate({
        set: { ...pkg, updatedAt: new Date() },
        target: topUpPackages.id,
      });
    console.log(`  ✓ ${pkg.id} (${pkg.displayName})`);
  }

  console.log('Done.');
};

const main = async () => {
  const db = await getServerDB();
  await seed(db);
  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
