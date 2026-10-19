import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import subscription from '@/locales/default/subscription';

import { ADMIN_NAV_GROUPS } from './adminNavigation';

const repoRoot = path.resolve(__dirname, '../../..');
const readRepoFile = (filePath: string) => readFileSync(path.resolve(repoRoot, filePath), 'utf8');
const zhCNSubscription = JSON.parse(readRepoFile('locales/zh-CN/subscription.json')) as Record<
  string,
  string
>;
const zhCNCommon = JSON.parse(readRepoFile('locales/zh-CN/common.json')) as Record<string, string>;

const filesWithAdminCopy = [
  'src/features/Admin/adminCatalog.ts',
  'src/features/Admin/adminNavigation.ts',
  'src/features/Admin/AdminDesktopUpdatePage.tsx',
  'src/features/Admin/AdminUserDetailDrawer.tsx',
  'src/routes/(main)/admin/audit/index.tsx',
  'src/routes/(main)/admin/subscriptions/index.tsx',
  'src/routes/(main)/admin/redemption/index.tsx',
  'src/routes/(main)/admin/users/index.tsx',
  'src/features/Admin/AdminFileStoragePage.tsx',
  'src/features/Admin/AdminNotificationsPage.tsx',
  'src/features/Admin/AdminSystemMaintenancePage.tsx',
  'src/features/Admin/AdminContentPages.tsx',
  'src/features/Admin/AdminExpertPlazaPage.tsx',
  'src/features/Admin/AdminDefaultSettingsPage.tsx',
  'src/features/Admin/AdminPlanFaqCard.tsx',
];

const corruptedFragments = [
  '????',
  '???',
  '閳?',
  '閸忔娊鏁?',
  '缁狅紕鎮?',
  '濡楀矂娼?',
  '婵傛',
  '鐠併垽',
  '閹垮秳缍?',
  '閻劍鍩?',
];

describe('admin Chinese copy', () => {
  it('keeps Module Center navigation labels in Simplified Chinese', () => {
    expect(zhCNCommon['moduleApps.admin.center.navigation.label']).toBe('模块中心分区');
    expect(zhCNCommon['moduleApps.admin.center.navigation.apps']).toBe('应用');
    expect(zhCNCommon['moduleApps.admin.center.navigation.finance']).toBe('财务');
    expect(zhCNCommon['moduleApps.admin.center.navigation.operations']).toBe('运维');
    expect(zhCNCommon['moduleApps.admin.center.navigation.audit']).toBe('审计');
  });

  it('does not ship corrupted fallback text in admin pages', () => {
    for (const file of filesWithAdminCopy) {
      const content = readRepoFile(file);
      for (const fragment of corruptedFragments) {
        expect(content, `${file} contains ${fragment}`).not.toContain(fragment);
      }
    }
  });

  it('uses readable Chinese navigation labels for billing pages', () => {
    const commercialItems =
      ADMIN_NAV_GROUPS.find((group) => group.key === 'commercial')?.items ?? [];

    expect(commercialItems.find((item) => item.path.endsWith('/subscriptions'))).toMatchObject({
      label: '订阅管理',
    });
    expect(commercialItems.find((item) => item.path.endsWith('/redemption'))).toMatchObject({
      label: '兑换码',
    });
    expect(commercialItems.find((item) => item.path.endsWith('/orders'))).toMatchObject({
      label: '平台订单与充值',
    });
  });

  it('keeps legacy sidebar fallback labels aligned with the merged admin navigation', () => {
    expect(subscription['admin.sidebar.orders']).toBe('订单与充值');
    expect(subscription['admin.sidebar.topup']).toBe('充值入口已合并');
    expect(subscription['admin.sidebar.pricing']).toBe('模型与计费矩阵');
  });

  it('keeps subscription customer-facing business pages in Chinese', () => {
    expect(zhCNSubscription['mobile.tabs.ariaLabel']).toBe('商业设置');
    expect(zhCNSubscription['tab.plans']).toBe('套餐');
    expect(zhCNSubscription['tab.usage']).toBe('用量');
    expect(zhCNSubscription['tab.credits']).toBe('积分');
    expect(zhCNSubscription['tab.billing']).toBe('账单');
    expect(zhCNSubscription['tab.referral']).toBe('推荐奖励');

    expect(zhCNSubscription['billing.history']).toBe('账单记录');
    expect(zhCNSubscription['credits.ledger.empty']).toBe('暂无积分流水');
    expect(zhCNSubscription['plans.current']).toBe('当前套餐');
    expect(zhCNSubscription['payment.success.title']).toBe('订阅成功');
    expect(zhCNSubscription['referral.stats.title']).toBe('推荐概览');
    expect(zhCNSubscription['usage.title']).toBe('本月用量');

    for (const key of [
      'billing.history',
      'credits.ledger.empty',
      'plans.current',
      'referral.stats.title',
      'usage.title',
    ] as const) {
      expect(zhCNSubscription[key]).not.toContain('????');
    }
  });

  it('keeps recommendation admin locale labels in Chinese', () => {
    expect(subscription['admin.recommendations.enabled']).toBe('启用推荐模块');
    expect(subscription['admin.recommendations.criteria']).toBe('推荐条件');
    expect(subscription['admin.recommendations.selectedTags']).toBe('用户选择标签');
    expect(subscription['admin.recommendations.assistantsEnabled']).toBe('显示推荐助手');
    expect(subscription['admin.recommendations.assistantTags']).toBe('助手标签/分类');
    expect(subscription['admin.recommendations.mcpsEnabled']).toBe('显示推荐 MCP/工具');
    expect(subscription['admin.recommendations.mcpCategories']).toBe('MCP 分类');
    expect(subscription['admin.recommendations.skillsEnabled']).toBe('显示推荐技能');
    expect(subscription['admin.recommendations.skillCategories']).toBe('推荐技能分类');
    expect(subscription['admin.recommendations.generalSkillsEnabled']).toBe('显示通用技能');
    expect(subscription['admin.recommendations.generalSkillCategories']).toBe('通用技能分类');
    expect(subscription['admin.recommendations.hotSkillsEnabled']).toBe('显示热门技能');
    expect(subscription['admin.recommendations.hotSkillSort']).toBe('热门技能排序');
    expect(subscription['admin.recommendations.saveSuccess']).toBe('推荐配置已保存');
    expect(subscription['admin.recommendations.saveFailed']).toBe('保存失败');
  });

  it('keeps operations growth orders and settings locale labels in Chinese', () => {
    expect(subscription['admin.orders.actionSuccess']).toBe('订单已更新');
    expect(subscription['admin.orders.cancel']).toBe('取消订单');
    expect(subscription['admin.orders.col.amount']).toBe('金额');
    expect(subscription['admin.orders.detail.title']).toBe('订单详情');
    expect(subscription['admin.orders.detail.redemptionCode']).toBe('关联兑换码');
    expect(subscription['admin.orders.detail.auditHint']).toBe(
      '如需追踪后台操作，请在审计日志中按订单 ID 检索。',
    );
    expect(subscription['admin.orders.detail.viewAudit']).toBe('查看审计日志');
    expect(subscription['admin.orders.loadMore']).toBe('加载更多');
    expect(subscription['admin.orders.settle']).toBe('手动结算');
    expect(subscription['admin.orders.settleConfirm']).toBe('确认手动结算这个待支付订单？');
    expect(subscription['admin.orders.settleConfirmDescription']).toBe(
      '该操作会将订单标记为已支付并发放积分，请核对以下信息。',
    );

    expect(subscription['admin.operations.bannerSection']).toBe('社区横幅');
    expect(subscription['admin.operations.featuredSection']).toBe('精选模块');
    expect(subscription['admin.operations.saveSuccess']).toBe('运营配置已保存');

    expect(subscription['admin.growth.signupSection']).toBe('注册');
    expect(subscription['admin.growth.initialCredits']).toBe('初始积分');
    expect(subscription['admin.growth.uploadSection']).toBe('上传限制');

    expect(subscription['admin.settings']).toBe('设置');
    expect(subscription['admin.settings.title']).toBe('站点基础设置');
    expect(subscription['admin.settings.save']).toBe('保存');
    expect(subscription['admin.settings.noChanges']).toBe('没有需要保存的变更');
    expect(subscription['admin.settings.brandName.help']).toBe(
      '用于页面标题、导航、关于页面和站内品牌展示。',
    );
    expect(subscription['admin.settings.defaultSkillName.help']).toBe(
      '用于配置内置默认技能的显示名称；留空时使用品牌名称。',
    );
    expect(subscription['admin.settings.defaultModel.help']).toBe(
      '默认模型、模型套餐权限和模型计费请在“模型与计费矩阵”维护。',
    );
    expect(subscription['admin.settings.defaultProvider.help']).toBe(
      '默认模型服务商已迁移到“模型与计费矩阵”维护。',
    );
    expect(subscription['admin.settings.defaultImageProvider.help']).toBe(
      '默认图像模型服务商已迁移到“模型与计费矩阵”维护。',
    );
    expect(subscription['admin.settings.defaultVideoProvider.help']).toBe(
      '默认视频模型服务商已迁移到“模型与计费矩阵”维护。',
    );
  });

  it('keeps default admin desktop update labels in Chinese', () => {
    expect(subscription['admin.sidebar.desktopUpdate']).toBe('桌面端控制中心');
    expect(subscription['admin.desktopUpdate.businessSection']).toBe('桌面业务连接');
    expect(subscription['admin.desktopUpdate.serverSection']).toBe('更新服务');
    expect(subscription['admin.desktopUpdate.downloadSection']).toBe('客户端下载入口');
    expect(subscription['admin.desktopUpdate.channel']).toBe('默认更新渠道');
    expect(subscription['admin.desktopUpdate.save']).toBe('保存');
  });

  it('includes default Chinese copy for provider instance management', () => {
    expect(subscription['admin.providers.createInstance']).toBe('新建实例');
    expect(subscription['admin.providers.empty']).toBe('暂未配置服务商实例');
    expect(subscription['admin.providers.field.providerType']).toBe('服务商类型');
    expect(subscription['admin.providers.field.providerTypeNewapiHint']).toBe(
      'AI 服务商网关支持同步模型和价格。',
    );
    expect(subscription['admin.providers.field.upstreamPricing']).toBe('同步上游价格');
    expect(subscription['admin.providers.field.lobeHubOfficialPricing']).toBe(
      '使用 LobeHub 官方价格',
    );
    expect(subscription['admin.providers.field.modelBankFallback']).toBe('按模型名使用系统价格');
    expect(subscription['admin.providers.models.bulkAddHint']).toBe(
      '可批量添加模型 ID，使用换行或逗号分隔。',
    );
    expect(subscription['admin.providers.sync.success']).toBe(
      '同步完成：删除 {{deletedCount}} 个旧模型，导入 {{count}} 个新模型；同步价格 {{pricingCount}} 条，能力信息覆盖 {{abilitiesCount}} 个模型。新模型默认未启用。',
    );
    expect(subscription['admin.providers.test.failed']).toBe('连接失败：{{error}}');
    expect(subscription['admin.providers.col.providerType']).toBe('服务商');
  });

  it('keeps redemption filters in Chinese', () => {
    const redemptionPage = readRepoFile('src/routes/(main)/admin/redemption/index.tsx');

    expect(redemptionPage).not.toContain("'Batch ID'");
    expect(redemptionPage).toContain("t('admin.redemption.filter.batch', '批次 ID')");
  });

  it('includes default Chinese copy for redemption bulk action flow', () => {
    expect(subscription['admin.bulkAction.count']).toBe('将处理 {{count}} 个项目。');
    expect(subscription['admin.bulkAction.progress']).toBe('正在执行批量操作，请勿关闭页面。');
    expect(subscription['admin.bulkAction.done']).toBe('批量操作已完成');
    expect(subscription['admin.redemption.bulkDisableProgress']).toBe(
      '正在停用选中的兑换码，请勿关闭页面。',
    );
    expect(subscription['admin.redemption.bulkDeleteProgress']).toBe(
      '正在删除选中的未兑换兑换码，请勿关闭页面。',
    );
    expect(subscription['admin.changeRequests.bulkApproveProgress']).toBe(
      '正在通过选中的套餐变更请求，请勿关闭页面。',
    );
    expect(subscription['admin.changeRequests.bulkRejectProgress']).toBe(
      '正在拒绝选中的套餐变更请求，请勿关闭页面。',
    );
  });

  it('includes default Chinese copy for assigning user plans from the user list', () => {
    const usersPage = readRepoFile('src/routes/(main)/admin/users/index.tsx');

    expect(subscription['admin.assignPlan']).toBe('设置套餐');
    expect(subscription['admin.assignPlan.title']).toBe('设置用户套餐');
    expect(subscription['admin.assignPlan.durationMonths']).toBe('使用时长（月）');
    expect(usersPage).toContain("t('admin.assignPlan', '设置套餐')");
    expect(usersPage).toContain('adminCommercialService.assignUserPlan');
    expect(usersPage).toContain("t('admin.impersonate', '以用户身份登录')");
  });

  it('includes readable copy for content governance and system defaults pages', () => {
    const catalog = readRepoFile('src/features/Admin/adminCatalog.ts');
    const contentPages = readRepoFile('src/features/Admin/AdminContentPages.tsx');
    const expertPlazaPage = readRepoFile('src/features/Admin/AdminExpertPlazaPage.tsx');
    const systemDefaultsPage = readRepoFile('src/features/Admin/AdminDefaultSettingsPage.tsx');

    expect(catalog).toContain("label: '内容与运营'");
    expect(catalog).toContain("label: 'AI 运行时默认值'");
    expect(contentPages).toContain('话题管理');
    expect(contentPages).toContain('资源文件管理');
    expect(contentPages).toContain('用户文稿管理');
    expect(expertPlazaPage).toContain('专家广场配置已保存');
    expect(systemDefaultsPage).toContain('服务模型默认设置 JSON');
    expect(systemDefaultsPage).toContain('默认助手模型');
    expect(systemDefaultsPage).toContain('提示词改写模型');
    expect(systemDefaultsPage).toContain('默认禁用的内置技能/工具');
  });

  it('refreshes public profile options after avatar presets are saved', () => {
    const systemDefaultsPage = readRepoFile('src/features/Admin/AdminDefaultSettingsPage.tsx');

    expect(systemDefaultsPage).toContain('PROFILE_OPTIONS_SWR_KEY');
  });

  it('keeps admin and public SWR cache keys centralized', () => {
    const systemDefaultsPage = readRepoFile('src/features/Admin/AdminDefaultSettingsPage.tsx');
    const expertPlazaAdminPage = readRepoFile('src/features/Admin/AdminExpertPlazaPage.tsx');
    const expertPlazaPage = readRepoFile('src/features/ExpertPlaza/index.tsx');
    const navLayout = readRepoFile('src/hooks/useNavLayout.ts');

    expect(systemDefaultsPage).toContain('ADMIN_SETTINGS_SECTION_SWR_KEY(scope)');
    expect(expertPlazaAdminPage).toContain('PUBLIC_EXPERT_PLAZA_SWR_KEY');
    expect(expertPlazaPage).toContain('PUBLIC_EXPERT_PLAZA_SWR_KEY');
    expect(navLayout).toContain('PUBLIC_EXPERT_PLAZA_SWR_KEY');
    expect(navLayout).toContain('SidebarTabKey.Ppt');
    expect(navLayout).toContain('SidebarTabKey.Experts');
    expect(navLayout).toContain('expertPlaza.enabled');
  });

  it('keeps the user detail drawer labels in Chinese for plan assignment and history tables', () => {
    const userDetailDrawer = readRepoFile('src/features/Admin/AdminUserDetailDrawer.tsx');

    expect(userDetailDrawer).toContain("t('admin.userDetail.assignPlan', '给用户分配套餐')");
    expect(userDetailDrawer).toContain("t('admin.userDetail.endTime', '结束时间')");
    expect(userDetailDrawer).toContain("t('admin.userDetail.ledgerType', '类型')");
    expect(userDetailDrawer).toContain("t('admin.userDetail.orderId', 'ID')");
  });
});
