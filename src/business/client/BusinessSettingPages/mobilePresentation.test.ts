import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const businessPages = ['Billing', 'Credits', 'Plans', 'Referral', 'Usage'];
const readBusinessPage = (pageName: string) =>
  readFile(
    path.join(process.cwd(), `src/business/client/BusinessSettingPages/${pageName}.tsx`),
    'utf8',
  );

describe('mobile business settings presentation', () => {
  it.each(businessPages)('%s uses the shared responsive page shell', async (pageName) => {
    const source = await readBusinessPage(pageName);

    expect(source).toContain('BusinessSettingsPageShell');
    expect(source).toContain('mobile={mobile}');
    expect(source).not.toContain('SettingHeader');
  });

  it('uses selectable snap cards and progressive disclosure on Plans', async () => {
    const source = await readBusinessPage('Plans');

    expect(source).toContain('getDefaultMobilePlanTarget');
    expect(source).toContain('scroll-snap-type: x mandatory');
    expect(source.match(/defaultOpen=\{false\}/g)).toHaveLength(3);
    expect(source).toContain('mobileAction={mobileAction}');
    expect(source).not.toContain('minWidth={0}');
  });

  it('uses the shared online checkout and real settings routes on Credits', async () => {
    const source = await readBusinessPage('Credits');
    const costEstimateSource = await readFile(
      path.join(process.cwd(), 'src/business/client/BusinessSettingPages/CostEstimateAlert.tsx'),
      'utf8',
    );

    expect(source).toContain('TopUpPurchase');
    expect(source).toContain('buildCreditLedgerRecord');
    expect(source).toContain('CostEstimateAlert');
    expect(source).toContain('AutoTopUpSettings');
    expect(source).toContain('CreditPackageList');
    expect(source).toContain('mobile ? (');
    expect(source).toContain('mobileAction={mobileAction}');
    expect(source).toContain('defaultOpen={false}');
    expect(source).toContain('href="/settings/usage"');
    expect(source).toContain('href="/settings/billing"');
    expect(source).not.toContain('在线支付暂未接入');
    expect(costEstimateSource).toContain("t('credits.costEstimateHint.unavailable')");
    expect(costEstimateSource).not.toContain('setSettings');
  });

  it('uses real payment orders as billing history and keeps plan changes secondary', async () => {
    const source = await readBusinessPage('Billing');

    expect(source).toContain('buildBillingOrderRecord');
    expect(source).toContain('buildBillingChangeRecord');
    expect(source).toContain('commercialService.listBillingOrders');
    expect(source).toContain("title={'账单历史'}");
    expect(source).toContain('href="/settings/usage"');
    expect(source).toContain("href: '/settings/plans'");
    expect(source).toContain('defaultOpen={false}');
    expect(source).toContain('BusinessMobileRecordList');
    expect(source).toContain('setBillingHistoryOpen(true)');
    expect(source).toContain("t('billing.summary.currentCycleAmount')");
  });

  it('shows referral records as cards and gates the reward action', async () => {
    const source = await readBusinessPage('Referral');

    expect(source).toContain('buildReferralHistoryRecord');
    expect(source).toContain('canActivateReward');
    expect(source).toContain('mobileAction={mobileAction}');
    expect(source).toContain('BusinessMobileRecordList');
    expect(source).toContain("title={t('referral.rules.backfill.title')}");
    expect(source).toContain("t('referral.copy.linkSuccess')");
    expect(source).not.toContain('`${label}已复制`');
  });

  it('matches the upstream usage information architecture without legacy charts', async () => {
    const usagePage = await readBusinessPage('Usage');
    const pageReturn = usagePage.slice(usagePage.lastIndexOf('return ('));
    const usageTable = await readFile(
      path.join(process.cwd(), 'src/routes/(main)/settings/stats/features/usage/UsageTable.tsx'),
      'utf8',
    );
    const usageBarChart = await readFile(
      path.join(
        process.cwd(),
        'src/routes/(main)/settings/stats/features/components/UsageBarChart.tsx',
      ),
      'utf8',
    );

    expect(usagePage).toContain('<UsageTable mobile={mobile} />');
    expect(usagePage).toContain('commercialService.getResourceUsage');
    expect(usagePage).toContain("title={'总览'}");
    expect(usagePage).not.toContain('UsageCards');
    expect(usagePage).not.toContain('UsageTrends');
    expect(usagePage).not.toContain('DatePicker');
    expect(usagePage).not.toContain('Segmented');
    expect(pageReturn.indexOf('{coreSection}')).toBeLessThan(
      pageReturn.indexOf('{detailsSection}'),
    );
    expect(usageTable).toContain('mobile ? (');
    expect(usageTable).toContain('buildUsageRecord');
    expect(usageTable.match(/usageService\.findByMonth/g)).toHaveLength(1);
    expect(usageBarChart).toContain('({ showType, ...props }: UsageBarChartProps)');
    expect(usageBarChart).not.toContain('props.showType');
  });
});
