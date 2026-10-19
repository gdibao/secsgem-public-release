import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const readRepoFile = (filePath: string) => readFileSync(path.resolve(repoRoot, filePath), 'utf8');

describe('admin commercial flow pages', () => {
  it('uses the shared admin UX shell on high-frequency management pages', () => {
    for (const filePath of [
      'src/features/Admin/AdminOrdersPage.tsx',
      'src/features/Admin/AdminSubscriptionsPage.tsx',
      'src/routes/(main)/admin/users/index.tsx',
    ]) {
      const page = readRepoFile(filePath);

      expect(page, filePath).toContain('AdminPageShell');
      expect(page, filePath).toContain('AdminResponsiveTable');
      expect(page, filePath).toContain('AdminToolbar');
    }

    const overviewPage = readRepoFile('src/features/Admin/AdminOverviewPage.tsx');
    const adminLayout = readRepoFile('src/routes/(main)/admin/_layout/index.tsx');

    expect(overviewPage).toContain('AdminMetricStrip');
    expect(overviewPage).not.toContain('<Card');
    expect(adminLayout).toContain('getAdminNavigationContext');
    expect(adminLayout).toContain('<FloatingSheet');
  });

  it('uses section-scoped reads on all settings-owning pages', () => {
    const sectionPages = {
      'desktop-update': 'src/features/Admin/DesktopControlCenter/index.tsx',
      'expert-plaza': 'src/features/Admin/AdminExpertPlazaPage.tsx',
      'file-storage': 'src/features/Admin/AdminFileStoragePage.tsx',
      'growth': 'src/features/Admin/AdminGrowthPage.tsx',
      'maintenance': 'src/features/Admin/AdminSystemMaintenancePage.tsx',
      'model-billing-matrix': 'src/features/Admin/AdminModelBillingMatrixPage.tsx',
      'model-policy': 'src/features/Admin/AdminModelPolicyPage.tsx',
      'notifications': 'src/features/Admin/AdminNotificationsPage.tsx',
      'operations': 'src/features/Admin/AdminOperationsPage.tsx',
      'ppt': 'src/features/Admin/AdminPptSettingsPage.tsx',
      'recommendations': 'src/features/Admin/AdminRecommendationsPage.tsx',
      'settings': 'src/features/Admin/AdminSettingsPage.tsx',
    } as const;

    for (const [section, filePath] of Object.entries(sectionPages)) {
      const page = readRepoFile(filePath);
      expect(page, filePath).toContain(`ADMIN_SETTINGS_SECTION_SWR_KEY('${section}')`);
      expect(page, filePath).toContain(`getSettingsSection('${section}')`);
      expect(page, filePath).not.toContain('getAllSettings()');
    }

    const overviewPage = readRepoFile('src/features/Admin/AdminOverviewPage.tsx');
    expect(overviewPage).toContain('adminCommercialService.getAllSettings()');
    expect(overviewPage).toContain('useClientDataSWR(ADMIN_SETTINGS_SWR_KEY');

    const defaultSettingsPage = readRepoFile('src/features/Admin/AdminDefaultSettingsPage.tsx');
    expect(defaultSettingsPage).toContain('ADMIN_SETTINGS_SECTION_SWR_KEY(scope)');
    expect(defaultSettingsPage).toContain('adminCommercialService.getSettingsSection(scope)');
    expect(defaultSettingsPage).not.toContain('getAllSettings()');

    const planFaqCard = readRepoFile('src/features/Admin/AdminPlanFaqCard.tsx');
    expect(planFaqCard).toContain("ADMIN_SETTINGS_SECTION_SWR_KEY('plans')");
    expect(planFaqCard).toContain("getSettingsSection('plans')");
    expect(planFaqCard).not.toContain('getAllSettings()');
  });

  it('loads file storage separately for image upload public URL prefixes', () => {
    for (const filePath of [
      'src/features/Admin/AdminSettingsPage.tsx',
      'src/features/Admin/AdminDefaultSettingsPage.tsx',
    ]) {
      const page = readRepoFile(filePath);
      expect(page, filePath).toContain("ADMIN_SETTINGS_SECTION_SWR_KEY('file-storage')");
      expect(page, filePath).toContain("getSettingsSection('file-storage')");
      expect(page, filePath).toContain('storageSettings?.storageS3PublicDomain');
      expect(page, filePath).not.toContain('sharedHealth?.storageS3PublicDomain');
    }
  });

  it('keeps recharge package management inside the orders management surface', () => {
    const ordersPage = readRepoFile('src/features/Admin/AdminOrdersPage.tsx');

    expect(ordersPage).toContain('AdminTopUpPackagesPage');
    expect(ordersPage).toContain("key: 'orders'");
    expect(ordersPage).toContain("key: 'topup'");
  });

  it('keeps plan change request handling inside the subscriptions management surface', () => {
    const subscriptionsPage = readRepoFile('src/features/Admin/AdminSubscriptionsPage.tsx');
    const subscriptionsRoute = readRepoFile('src/routes/(main)/admin/subscriptions/index.tsx');

    expect(subscriptionsPage).toContain('AdminChangeRequestsPage');
    expect(subscriptionsPage).toContain("key: 'subscriptions'");
    expect(subscriptionsPage).toContain("key: 'changeRequests'");
    expect(subscriptionsRoute).toContain(
      "import AdminSubscriptionsPage from '@/features/Admin/AdminSubscriptionsPage'",
    );
  });

  it('uses one shared assign-plan modal for user list and user detail operations', () => {
    const usersPage = readRepoFile('src/routes/(main)/admin/users/index.tsx');
    const userDetailDrawer = readRepoFile('src/features/Admin/AdminUserDetailDrawer.tsx');

    expect(usersPage).toContain(
      "import AdminAssignPlanModal from '@/features/Admin/AdminAssignPlanModal'",
    );
    expect(userDetailDrawer).toContain("import AdminAssignPlanModal from './AdminAssignPlanModal'");
    expect(usersPage).toContain('<AdminAssignPlanModal');
    expect(userDetailDrawer).toContain('<AdminAssignPlanModal');
  });

  it('keeps admin subscription cycle controls aligned with backend validation', () => {
    const assignPlanModal = readRepoFile('src/features/Admin/AdminAssignPlanModal.tsx');
    const subscriptionsPage = readRepoFile('src/features/Admin/AdminSubscriptionsPage.tsx');
    const subscriptionsRouter = readRepoFile(
      'packages/business-server/src/lambda-routers/admin/subscriptions.ts',
    );
    const userDetailDrawer = readRepoFile('src/features/Admin/AdminUserDetailDrawer.tsx');
    const usersPage = readRepoFile('src/routes/(main)/admin/users/index.tsx');

    expect(assignPlanModal).toContain('ADMIN_SUBSCRIPTION_CYCLES.map');
    expect(assignPlanModal).toContain('isFiniteAdminSubscriptionCycle(cycle)');
    expect(subscriptionsPage).toContain('ADMIN_SUBSCRIPTION_CYCLES.map');
    expect(subscriptionsRouter).toContain(
      "const SUBSCRIPTION_CYCLES = ['monthly', 'yearly', 'one_time', 'lifetime'] as const",
    );
    expect(userDetailDrawer).toContain('isFiniteAdminSubscriptionCycle(assignCycle)');
    expect(usersPage).toContain('isFiniteAdminSubscriptionCycle(assignCycle)');
  });

  it('does not keep the removed standalone pricing settings helper', () => {
    expect(existsSync(path.resolve(repoRoot, 'src/features/Admin/adminPricingSettings.ts'))).toBe(
      false,
    );
    expect(
      existsSync(path.resolve(repoRoot, 'src/features/Admin/adminPricingSettings.test.ts')),
    ).toBe(false);
  });

  it('does not keep the old generic admin placeholder page', () => {
    expect(existsSync(path.resolve(repoRoot, 'src/features/Admin/AdminPagePlaceholder.tsx'))).toBe(
      false,
    );

    const adminIndex = readRepoFile('src/features/Admin/index.ts');
    expect(adminIndex).not.toContain('AdminPagePlaceholder');
  });

  it('lets admin configure public recommendation section titles', () => {
    const appSettingsRegistry = readRepoFile('src/const/appSettingsRegistry.ts');
    const adminReadModel = readRepoFile(
      'packages/business-server/src/appSettings/adminReadModel.ts',
    );
    const adminRecommendations = readRepoFile('src/features/Admin/AdminRecommendationsPage.tsx');
    const publicRecommendations = readRepoFile('src/features/CommunityRecommendations/index.tsx');

    for (const key of [
      'recommendationAssistantTitle',
      'recommendationMcpTitle',
      'recommendationSkillTitle',
      'recommendationGeneralSkillTitle',
      'recommendationHotSkillTitle',
    ]) {
      expect(appSettingsRegistry).toContain(key);
      expect(adminReadModel).toContain(`APP_SETTING_KEYS.${key}`);
    }

    expect(adminRecommendations).toContain('name="assistantTitle"');
    expect(adminRecommendations).toContain('name="mcpTitle"');
    expect(adminRecommendations).toContain('name="skillTitle"');
    expect(adminRecommendations).toContain('name="generalSkillTitle"');
    expect(adminRecommendations).toContain('name="hotSkillTitle"');

    expect(publicRecommendations).toContain('config.assistantTitle');
    expect(publicRecommendations).toContain('config.mcpTitle');
    expect(publicRecommendations).toContain('config.skillTitle');
    expect(publicRecommendations).toContain('config.generalSkillTitle');
    expect(publicRecommendations).toContain('config.hotSkillTitle');
  });

  it('uses provider-neutral copy for shared model center surfaces', () => {
    const matrixPage = readRepoFile('src/features/Admin/AdminModelBillingMatrixPage.tsx');
    const providersPage = readRepoFile('src/features/Admin/AdminProvidersPage.tsx');
    const settingsPage = readRepoFile('src/features/Admin/AdminSettingsPage.tsx');
    const modelPolicyPage = readRepoFile('src/features/Admin/AdminModelPolicyPage.tsx');

    expect(matrixPage).not.toContain('暂无已启用的 NewAPI 模型');
    expect(providersPage).not.toContain('配置多个 NewAPI 上游实例');
    expect(settingsPage).not.toContain('LobeHub 品牌名称');
    expect(settingsPage).not.toContain('LobeHub 显示名称');
    expect(settingsPage).not.toContain('使用 NewAPI 转站');
    expect(settingsPage).not.toContain('使用 NewAPI 图像模型');
    expect(settingsPage).not.toContain('使用 NewAPI 视频模型');
    expect(settingsPage).not.toContain('例如 newapi');
    expect(settingsPage).not.toContain('placeholder="newapi"');
    expect(modelPolicyPage).not.toContain("placeholder={'newapi:");
    expect(providersPage).not.toContain('NewAPI 支持同步模型和价格');
    expect(matrixPage).toContain('暂无已启用的服务商模型');
    expect(providersPage).toContain('配置多个服务商上游实例');
    expect(settingsPage).toContain('默认模型请到“模型与计费矩阵”');
    expect(matrixPage).toContain('默认模型健康检查');
  });

  it('uses provider-neutral i18n keys for the admin provider page', () => {
    const providersPage = readRepoFile('src/features/Admin/AdminProvidersPage.tsx');

    expect(providersPage).toContain('admin.providers.');
    expect(providersPage).not.toContain('admin.newapi.');
  });

  it('uses AI service provider service helpers as the provider page primary API', () => {
    const providersPage = readRepoFile('src/features/Admin/AdminProvidersPage.tsx');
    const service = readRepoFile('src/services/adminCommercial.ts');

    for (const method of [
      'listAiProviderInstances',
      'createAiProviderInstance',
      'updateAiProviderInstance',
      'deleteAiProviderInstance',
      'toggleAiProviderInstance',
      'testAiProviderInstanceConnection',
      'syncAiProviderInstanceModels',
      'listAiProviderInstanceModels',
      'addAiProviderInstanceModels',
      'removeAiProviderInstanceModel',
      'updateAiProviderInstanceModel',
    ]) {
      expect(service).toContain(method);
      expect(providersPage).toContain(`adminCommercialService.${method}`);
    }

    for (const legacyMethod of [
      'listNewapiInstances',
      'createNewapiInstance',
      'updateNewapiInstance',
      'deleteNewapiInstance',
      'toggleNewapiInstance',
      'testNewapiInstanceConnection',
      'syncNewapiInstanceModels',
      'listNewapiInstanceModels',
      'addNewapiInstanceModels',
      'removeNewapiInstanceModel',
      'updateNewapiInstanceModel',
    ]) {
      expect(providersPage).not.toContain(`adminCommercialService.${legacyMethod}`);
    }
  });

  it('refreshes frontend provider runtime state after admin provider model changes', () => {
    const providersPage = readRepoFile('src/features/Admin/AdminProvidersPage.tsx');

    expect(providersPage).toContain("import { useAiInfraStore } from '@/store/aiInfra'");
    expect(providersPage).toContain('refreshAiProviderRuntimeState');
    expect(providersPage).toContain('const handleBatchToggle = async (enabled: boolean)');
    expect(providersPage).toContain("t('admin.providers.models.enableAll'");
    expect(providersPage).toContain("t('admin.providers.models.disableAll'");
    expect(providersPage.match(/await refreshModels\(\);/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('exposes an admin action to refresh user-facing AI provider cache', () => {
    const providersPage = readRepoFile('src/features/Admin/AdminProvidersPage.tsx');
    const service = readRepoFile('src/services/adminCommercial.ts');
    const router = readRepoFile(
      'packages/business-server/src/lambda-routers/admin/newapiProviders.ts',
    );

    expect(router).toContain('refreshRuntimeCache: modelOpsWriteProcedure.mutation');
    expect(router).toContain('invalidateNewapiInstancesCache();');
    expect(router).toContain("action: 'newapiInstanceModels.refreshRuntimeCache'");
    expect(service).toContain('refreshAiProviderRuntimeCache');
    expect(service).toContain('newapiProviders.refreshRuntimeCache.mutate()');
    expect(providersPage).toContain('handleRefreshRuntimeCache');
    expect(providersPage).toContain('adminCommercialService.refreshAiProviderRuntimeCache()');
    expect(providersPage).toContain('mutate(serverConfigKeys.get)');
    expect(providersPage).toContain('refreshAiProviderRuntimeState()');
    expect(providersPage).toContain("t('admin.providers.refreshRuntimeCache.action'");
  });

  it('lets admins configure AI provider model official cost pricing', () => {
    const providersPage = readRepoFile('src/features/Admin/AdminProvidersPage.tsx');
    const pricingCell = readRepoFile('src/features/Admin/adminProviderModelPricing.tsx');
    const runtime = readRepoFile('src/server/services/newapiInstance/index.ts');
    const service = readRepoFile('src/services/adminCommercial.ts');
    const router = readRepoFile(
      'packages/business-server/src/lambda-routers/admin/newapiProviders.ts',
    );

    expect(providersPage).toContain('AiProviderModelPricingCell');
    expect(providersPage).toContain('buildManualTokenPricingMetadata');
    expect(providersPage).toContain('buildManualMediaPricingMetadata');
    expect(pricingCell).toContain('DEFAULT_PRICING_CREDIT_MULTIPLIER');
    expect(pricingCell).toContain('DEFAULT_PRICING_MARGIN_MULTIPLIER');
    expect(pricingCell).toContain('TOKEN_PRICING_MODEL_TYPES');
    expect(pricingCell).toContain('IMAGE_PRICING_MODEL_TYPES');
    expect(pricingCell).toContain('VIDEO_PRICING_MODEL_TYPES');
    expect(pricingCell).toContain('inputCostRate');
    expect(pricingCell).toContain('outputCostRate');
    expect(pricingCell).toContain('imageRate');
    expect(pricingCell).toContain('videoRate');
    expect(providersPage).toContain("'成本价'");
    expect(pricingCell).toContain('官方成本：输入 {{input}} / 输出 {{output}}');
    expect(pricingCell).toContain('官方成本：{{cost}} / 张');
    expect(pricingCell).toContain('官方成本：{{cost}} / 条');
    expect(service).toContain('metadata?: Record<string, unknown> | null');
    expect(router).toContain('ModelMetadataSchema');
    expect(router).toContain("action: 'newapiInstanceModels.update'");
    expect(runtime).toContain('resolveManualPricing');
    expect(runtime).toContain('manualPricing.inputCostRate');
    expect(runtime).toContain('manualPricing.outputCostRate');
    expect(runtime).toContain('manualPricing.imageRate');
    expect(runtime).toContain('manualPricing.videoRate');
  });

  it('lets admins configure AI provider model abilities for user-facing model cards', () => {
    const providersPage = readRepoFile('src/features/Admin/AdminProvidersPage.tsx');
    const abilitiesCell = readRepoFile('src/features/Admin/adminProviderModelAbilities.tsx');
    const runtime = readRepoFile('src/server/services/newapiInstance/index.ts');
    const globalConfig = readRepoFile('apps/server/src/globalConfig/index.ts');

    expect(providersPage).toContain('AiProviderModelAbilitiesCell');
    expect(providersPage).toContain('buildManualAbilitiesMetadata');
    expect(providersPage).toContain("t('admin.providers.models.col.abilities'");
    expect(abilitiesCell).toContain('manualAbilities');
    expect(abilitiesCell).toContain('functionCall');
    expect(abilitiesCell).toContain('reasoning');
    expect(abilitiesCell).toContain('vision');
    expect(runtime).toContain('resolveManualAbilities');
    expect(runtime).toContain('metadata?.manualAbilities');
    expect(globalConfig).toContain('m.abilities ? { abilities: m.abilities } : {}');
  });

  it('keeps toapi as a NewAPI-compatible instance instead of a standalone provider type', () => {
    const files = [
      'packages/business-server/src/lambda-routers/admin/newapiProviders.ts',
      'packages/database/src/schemas/newapiInstance.ts',
      'src/features/Admin/AdminProvidersPage.tsx',
      'src/features/Admin/adminProviderInstanceForm.ts',
      'src/server/services/newapiInstance/catalog.ts',
      'src/server/services/newapiInstance/index.ts',
      'src/services/adminCommercial.ts',
    ];

    for (const file of files) {
      const source = readRepoFile(file);
      expect(source).toContain('siliconflow');
      expect(source.toLowerCase()).not.toContain("'toapi'");
      expect(source.toLowerCase()).not.toContain('"toapi"');
    }
  });

  it('uses AI service provider model helpers in shared model billing surfaces', () => {
    const matrixPage = readRepoFile('src/features/Admin/AdminModelBillingMatrixPage.tsx');
    const service = readRepoFile('src/services/adminCommercial.ts');

    expect(service).toContain('listAllEnabledAiProviderModels');
    expect(matrixPage).toContain('adminCommercialService.listAllEnabledAiProviderModels');
    expect(matrixPage).not.toContain('adminCommercialService.listAllEnabledNewapiModels');
  });

  it('returns model pricing and ability completeness flags for billing diagnostics', () => {
    const matrixPage = readRepoFile('src/features/Admin/AdminModelBillingMatrixPage.tsx');
    const router = readRepoFile(
      'packages/business-server/src/lambda-routers/admin/newapiProviders.ts',
    );

    expect(router).toContain('metadata: adminNewapiInstanceModels.metadata');
    expect(router).toContain('hasModelPricing');
    expect(router).toContain('hasModelAbilities');
    expect(router).toContain('resolveModelPricingCompleteness');
    expect(router).toContain('resolveModelAbilityCompleteness');
    expect(matrixPage).toContain('hasModelPricing: item.hasModelPricing === true');
    expect(matrixPage).toContain('hasModelAbilities: item.hasModelAbilities === true');
  });

  it('surfaces AI service model access and billing health in the matrix page', () => {
    const matrixPage = readRepoFile('src/features/Admin/AdminModelBillingMatrixPage.tsx');
    const matrixLogic = readRepoFile('src/features/Admin/adminModelBillingMatrix.ts');

    expect(matrixLogic).toContain('getMatrixConfigHealth');
    expect(matrixLogic).toContain('plans-without-models');
    expect(matrixLogic).toContain('blocked-models');
    expect(matrixLogic).toContain('pricing-fallbacks');
    expect(matrixLogic).toContain('getMatrixConfigHealthFocus');
    expect(matrixPage).toContain('AI service health check');
    expect(matrixPage).toContain('configHealth.summary.modelCount');
    expect(matrixPage).toContain('configHealth.checks.map');
    expect(matrixPage).toContain('focusedHealthCheckKey');
    expect(matrixPage).toContain('handleFocusConfigHealthCheck');
    expect(matrixPage).toContain('显示全部');
  });

  it('keeps plan model access visible but editable only through the shared matrix', () => {
    const plansPage = readRepoFile('src/routes/(main)/admin/plans/index.tsx');
    const planRules = readRepoFile('src/features/Admin/adminPlanModelRules.ts');

    expect(plansPage).toContain('getPlanModelRulesSummaryInfo');
    expect(plansPage).toContain('ADMIN_PLAN_MODEL_MATRIX_PATH');
    expect(plansPage).toContain('白名单 {summary.allowlistTypeCount}');
    expect(plansPage).toContain('黑名单 {summary.blocklistTypeCount}');
    expect(planRules).toContain('默认开放全部已启用模型');
    expect(planRules).toContain('allowlistEntryCount');
    expect(planRules).toContain('blocklistEntryCount');
    expect(plansPage).not.toContain('setPlanModelRules');
  });

  it('keeps the public plans page aligned with dynamic matrix model billing', () => {
    const publicPlansPage = readRepoFile('src/business/client/BusinessSettingPages/Plans.tsx');
    const planFaqCard = readRepoFile('src/features/Admin/AdminPlanFaqCard.tsx');
    const adminReadModel = readRepoFile(
      'packages/business-server/src/appSettings/adminReadModel.ts',
    );
    const subscriptionRouter = readRepoFile(
      'packages/business-server/src/lambda-routers/subscription.ts',
    );

    expect(publicPlansPage).toContain('getModelAccessSummary');
    expect(publicPlansPage).toContain('默认开放全部已启用模型');
    expect(publicPlansPage).toContain('模型与计费矩阵');
    expect(publicPlansPage).toContain('模型价格随后台配置动态生效');
    expect(publicPlansPage).toContain('升级方案');
    expect(publicPlansPage).toContain('解锁更多容量与高级功能');
    expect(publicPlansPage).toContain('文本模型价格');
    expect(publicPlansPage).toContain('commercialService.listPlanFaq');
    expect(publicPlansPage).toContain('PUBLIC_PLAN_FAQ_SWR_KEY');
    expect(publicPlansPage).toContain('getAvailableBillingCycles');
    expect(publicPlansPage).toContain('availableBillingCycles.map');
    expect(publicPlansPage).toContain('hasAvailableBillingCycles');
    expect(publicPlansPage).toContain('暂无可购买周期');
    expect(publicPlansPage).toContain('activeBillingCycle');
    expect(publicPlansPage).toContain('!price.isAvailable');
    expect(publicPlansPage).toContain('planFaqItems.map');
    expect(planFaqCard).toContain('name="planFaqItems"');
    expect(planFaqCard).toContain('APP_SETTING_KEYS.plansFaqItems');
    expect(adminReadModel).toContain('APP_SETTING_KEYS.plansFaqItems');
    expect(subscriptionRouter).toContain('listPlanFaq');
    expect(publicPlansPage).not.toContain("key: 'usage-fast'");
    expect(publicPlansPage).not.toContain('lobehub.com/docs');
    expect(publicPlansPage).not.toContain('mailto:support@lobehub.com');
    expect(publicPlansPage).not.toContain('MODEL_MESSAGE_ESTIMATES');
    expect(publicPlansPage).not.toContain('MODEL_PRICE_ROWS');
    expect(publicPlansPage).not.toContain('DeepSeek V4 Pro');
    expect(publicPlansPage).not.toContain('GPT-5.5');
  });

  it('surfaces app settings governance in the admin settings page', () => {
    const settingsReadProcedures = readRepoFile(
      'packages/business-server/src/appSettings/readers/adminProcedures.ts',
    );
    const settingsWriteProcedures = readRepoFile(
      'packages/business-server/src/appSettings/writers/adminProcedures.ts',
    );
    const service = readRepoFile('src/services/adminCommercial.ts');
    const settingsPage = readRepoFile('src/features/Admin/AdminSettingsPage.tsx');
    const governanceCard = readRepoFile('src/features/Admin/AdminSettingsGovernanceCard.tsx');

    expect(settingsReadProcedures).toContain('getGovernance: systemReadProcedure.query');
    expect(settingsWriteProcedures).toContain('deleteUnknownSetting: systemWriteProcedure');
    expect(service).toContain('getAppSettingsGovernance');
    expect(service).toContain('admin.settings.getGovernance.query()');
    expect(service).toContain('deleteUnknownAppSetting');
    expect(service).toContain('admin.settings.deleteUnknownSetting.mutate(params)');
    expect(settingsPage).toContain('AdminSettingsGovernanceCard');
    expect(governanceCard).toContain('unknownKeys');
    expect(governanceCard).toContain('deleteUnknownAppSetting');
    expect(governanceCard).toContain('confirmKey');
    expect(governanceCard).toContain('sensitiveConfiguredKeys');
    expect(governanceCard).not.toContain('item.value');
    expect(governanceCard).not.toContain('dataSource={data.registeredSettings}');
  });

  it('does not materialize admin settings before current data has loaded', () => {
    const settingsPage = readRepoFile('src/features/Admin/AdminSettingsPage.tsx');

    expect(settingsPage).toContain('if (!data) return;');
    expect(settingsPage).toContain('disabled={isLoading || !data || submitting}');
  });

  it('does not materialize notification defaults before current data has loaded', () => {
    const notificationsPage = readRepoFile('src/features/Admin/AdminNotificationsPage.tsx');

    expect(notificationsPage).toContain('if (!data) return;');
    expect(notificationsPage).toContain('disabled={isLoading || !data || submitting}');
    expect(notificationsPage).toContain('disabled={isLoading || !data || materializing}');
  });

  it('does not fall back to built-in help links when admin explicitly clears the menu', () => {
    const footer = readRepoFile('src/routes/(main)/home/_layout/Footer/index.tsx');

    expect(footer).toContain('data: configuredHelpMenuItems');
    expect(footer).not.toContain('configuredMenuItems.length > 0');
    expect(footer).not.toContain('configuredHelpMenuItems.length > 0');
  });

  it('shows admin-configured top-up promotion metadata in admin and user credit surfaces', () => {
    const topupPage = readRepoFile('src/features/Admin/AdminTopUpPackagesPage.tsx');
    const creditsPage = readRepoFile('src/business/client/BusinessSettingPages/Credits.tsx');

    expect(topupPage).toContain('normalizeTopUpPackagePromotion(row.metadata)');
    expect(topupPage).toContain('admin.topup.col.promotion');
    expect(creditsPage).toContain('限时优惠');
    expect(creditsPage).toContain('优先使用订阅积分，其次使用充值积分');
  });

  it('keeps billing page actions and cycle dates aligned with configured plans', () => {
    const billingPage = readRepoFile('src/business/client/BusinessSettingPages/Billing.tsx');

    expect(billingPage).toContain('subscriptionSummary?.cycle');
    expect(billingPage).toContain('subscriptionSummary?.renewsAt');
    expect(billingPage).toContain('subscriptionSummary?.endsAt');
    expect(billingPage).toContain('href="/settings/plans"');
    expect(billingPage).toContain('套餐变更记录');
    expect(billingPage).not.toContain('发票');
  });

  it('keeps credits top-up purchase state honest while online payment is unavailable', () => {
    const creditsPage = readRepoFile('src/business/client/BusinessSettingPages/Credits.tsx');
    const adminTopupPage = readRepoFile('src/features/Admin/AdminTopUpPackagesPage.tsx');
    const adminPlansPage = readRepoFile('src/routes/(main)/admin/plans/index.tsx');

    expect(creditsPage).toContain('isPaidPlan(currentPlan)');
    expect(creditsPage).toContain("href={canPurchaseTopUp ? undefined : '/settings/plans'}");
    expect(creditsPage).toContain('在线支付暂未接入');
    expect(adminTopupPage).toContain("currency: 'USD'");
    expect(adminTopupPage).toContain("values.currency || 'USD'");
    expect(adminPlansPage).toContain('留空时前台不展示');
  });

  it('renders order control as fail-closed compatibility state and never submits it', () => {
    const billingMatrixPage = readRepoFile('src/features/Admin/AdminModelBillingMatrixPage.tsx');
    const defaultLocale = readRepoFile('packages/locales/src/default/subscription.ts');
    const enLocale = readRepoFile('locales/en-US/subscription.json');
    const zhLocale = readRepoFile('locales/zh-CN/subscription.json');

    expect(billingMatrixPage).toContain('checked={false}');
    expect(billingMatrixPage).toContain('disabled');
    expect(billingMatrixPage).toContain("'admin.pricing.ordersEnabled'");
    expect(billingMatrixPage).not.toContain('SETTING_KEYS.ordersManagementEnabled');
    expect(defaultLocale).toContain("'admin.pricing.ordersEnabled': '在线平台支付（已关闭）'");
    expect(enLocale).toContain(
      '"admin.pricing.ordersEnabled": "Online platform payment (disabled)"',
    );
    expect(zhLocale).toContain('"admin.pricing.ordersEnabled": "在线平台支付（已关闭）"');
  });

  it('uses configured brand and keeps a non-duplicative usable balance summary on credits page', () => {
    const creditsPage = readRepoFile('src/business/client/BusinessSettingPages/Credits.tsx');

    expect(creditsPage).toContain("import { useBrand } from '@/features/Brand/BrandProvider'");
    expect(creditsPage).toContain('const brand = useBrand();');
    expect(creditsPage).toContain('{brand.name} Subscription');
    expect(creditsPage).toContain('formatCredits(accountSummary?.balance ?? 0)');
    expect(creditsPage).not.toContain('LOBEHUB CLOUD SUBSCRIPTION');
    expect(creditsPage).not.toContain('充值积分余额</div>');
  });

  it('uses provider-neutral file names for the admin provider page', () => {
    expect(existsSync(path.resolve(repoRoot, 'src/features/Admin/AdminProvidersPage.tsx'))).toBe(
      true,
    );
    expect(
      existsSync(path.resolve(repoRoot, 'src/features/Admin/AdminNewapiProvidersPage.tsx')),
    ).toBe(false);
    expect(
      existsSync(path.resolve(repoRoot, 'src/features/Admin/adminProviderInstanceForm.ts')),
    ).toBe(true);
    expect(
      existsSync(path.resolve(repoRoot, 'src/features/Admin/adminNewapiInstanceForm.ts')),
    ).toBe(false);
  });

  it('uses the provider-neutral admin route for service provider management', () => {
    const adminCatalog = readRepoFile('src/features/Admin/adminCatalog.ts');
    const desktopRouteRegistry = readRepoFile('src/business/client/adminSettingsRouteRegistry.ts');

    expect(existsSync(path.resolve(repoRoot, 'src/routes/(main)/admin/providers/index.tsx'))).toBe(
      true,
    );
    expect(
      existsSync(path.resolve(repoRoot, 'src/routes/(main)/admin/newapi-providers/index.tsx')),
    ).toBe(false);
    expect(desktopRouteRegistry).toContain("import('@/routes/(main)/admin/providers')");
    expect(adminCatalog).toContain("segment: 'providers'");
    expect(desktopRouteRegistry).not.toContain('newapi-providers');
  });

  it('wires centralized dangerous action confirmations into high-risk admin surfaces', () => {
    const creditsPage = readRepoFile('src/routes/(main)/admin/credits/index.tsx');
    const providersPage = readRepoFile('src/features/Admin/AdminProvidersPage.tsx');
    const redemptionPage = readRepoFile('src/routes/(main)/admin/redemption/index.tsx');
    const usersPage = readRepoFile('src/routes/(main)/admin/users/index.tsx');
    const userDetailDrawer = readRepoFile('src/features/Admin/AdminUserDetailDrawer.tsx');
    const contentPages = readRepoFile('src/features/Admin/AdminContentPages.tsx');
    const ordersPage = readRepoFile('src/features/Admin/AdminOrdersPage.tsx');
    const maintenancePage = readRepoFile('src/features/Admin/AdminSystemMaintenancePage.tsx');

    expect(creditsPage).toContain('AdminDangerousActionButton');
    expect(creditsPage).toContain('actionId="credits.adjust"');

    expect(providersPage).toContain('AdminDangerousActionButton');
    expect(providersPage).toContain('actionId="newapiProvider.deleteInstance"');

    expect(usersPage).toContain('AdminDangerousActionButton');
    expect(usersPage).toContain('actionId="user.resetAllToFreePlan"');
    expect(usersPage).toContain('actionId="credits.adjust"');
    expect(usersPage).toContain('actionId="user.impersonate.attempt"');
    expect(usersPage).toContain('actionId="user.setRole"');
    expect(usersPage).not.toContain('Modal.confirm');

    expect(userDetailDrawer).toContain('AdminDangerousActionButton');
    expect(userDetailDrawer).toContain('actionId="credits.adjust"');

    for (const actionId of [
      'content.deleteTopic',
      'content.deleteFile',
      'content.deleteDocument',
    ]) {
      expect(contentPages).toContain(`actionId="${actionId}"`);
    }

    expect(ordersPage).toContain('actionId="order.expire"');
    expect(ordersPage).toContain('actionId="order.cancel"');
    expect(ordersPage).toContain('actionId="order.settle"');
    expect(ordersPage).toContain('adminCommercialService.settleOrder');

    expect(redemptionPage).toContain('AdminBulkActionFlow');
    expect(redemptionPage).toContain('actionId="redemption.bulkDisable"');
    expect(redemptionPage).toContain('actionId="redemption.bulkDelete"');

    expect(maintenancePage).toContain('AdminDangerousActionButton');
    expect(maintenancePage).toContain('actionId="setting.runMaintenance"');
  });

  it('shows dependency impact before plan, provider, or model deletion', () => {
    const plansPage = readRepoFile('src/routes/(main)/admin/plans/index.tsx');
    const providersPage = readRepoFile('src/features/Admin/AdminProvidersPage.tsx');
    const dangerousButton = readRepoFile('src/features/Admin/AdminDangerousActionButton.tsx');
    const impactPreview = readRepoFile('src/features/Admin/AdminDependencyImpactPreview.tsx');

    expect(plansPage).toContain('adminCommercialService.getPlanDeleteImpact(plan)');
    expect(plansPage).toContain('<AdminDependencyImpactPreview impact={impact} />');
    expect(providersPage).toContain('getAiProviderModelDeleteImpact(target)');
    expect(providersPage).toContain('getAiProviderInstanceDeleteImpact(row.id)');
    expect(providersPage).toContain('disabled: !impact.canProceed');
    expect(dangerousButton).toContain('disabled: Boolean(loadPreflight)');
    expect(dangerousButton).toContain('closable={!submitting}');
    expect(dangerousButton).toContain('keyboard={!submitting}');
    expect(dangerousButton).toContain('maskClosable={!submitting}');
    expect(dangerousButton).toContain('if (!submitting) closeTypedConfirm();');
    expect(impactPreview).toContain('impact.blocking');
    expect(impactPreview).toContain('impact.immediateEffects');
    expect(impactPreview).toContain('impact.liveEffects');
  });

  it('exposes module app product and price management from the selected app view', () => {
    const productsPage = readRepoFile(
      'src/features/Admin/moduleApps/apps/products/ModuleAppProductsPage.tsx',
    );
    const routeCatalog = readRepoFile('src/features/Admin/moduleApps/navigation/catalog.ts');

    expect(productsPage).toContain("import ProductManager from '../../ProductManager'");
    expect(productsPage).toContain('<ProductManager appId={app.id} canWrite={canWrite} />');
    expect(routeCatalog).toContain("{ id: 'module-app-products', segment: 'products' }");
    expect(routeCatalog).toContain("createSection('module-app-products', 'Products')");
  });

  it('localizes centralized dangerous action confirmation microcopy', () => {
    const dangerousButton = readRepoFile('src/features/Admin/AdminDangerousActionButton.tsx');
    const enSubscription = readRepoFile('locales/en-US/subscription.json');
    const zhSubscription = readRepoFile('locales/zh-CN/subscription.json');

    expect(dangerousButton).toContain("useTranslation('subscription')");
    expect(dangerousButton).toContain('admin.dangerousAction.typedConfirm');
    expect(dangerousButton).toContain('admin.dangerousAction.reasonPlaceholder');
    expect(dangerousButton).toContain('admin.dangerousAction.errors.');
    expect(dangerousButton).toContain('buildAdminDangerousActionEnvelope');
    expect(dangerousButton).not.toContain("setError(result.errors.join(', '))");
    expect(dangerousButton).not.toContain('placeholder="Reason"');
    expect(dangerousButton).not.toContain('Type <Typography.Text code>');

    for (const locale of [enSubscription, zhSubscription]) {
      for (const key of [
        'admin.dangerousAction.typedConfirm',
        'admin.dangerousAction.reasonPlaceholder',
        'admin.dangerousAction.errors.confirmation_required',
        'admin.dangerousAction.errors.confirmation_text_mismatch',
        'admin.dangerousAction.errors.reason_required',
        'admin.dangerousAction.errors.unknown_action',
        'admin.bulkAction.cancel',
        'admin.bulkAction.confirm',
        'admin.bulkAction.close',
        'admin.bulkAction.progress',
        'admin.bulkAction.done',
        'admin.bulkAction.error',
        'admin.bulkAction.errorFallback',
      ]) {
        expect(locale).toContain(`"${key}"`);
      }
    }
  });

  it('uses a modal state machine for redemption bulk operations', () => {
    const bulkActionFlow = readRepoFile('src/features/Admin/AdminBulkActionFlow.tsx');
    const redemptionPage = readRepoFile('src/routes/(main)/admin/redemption/index.tsx');

    expect(bulkActionFlow).toContain(
      "type AdminBulkActionFlowStep = 'confirm' | 'progress' | 'done' | 'error'",
    );
    expect(bulkActionFlow).toContain("closable={step !== 'progress'}");
    expect(bulkActionFlow).toContain("maskClosable={step !== 'progress'}");
    expect(bulkActionFlow).toContain('NeuralNetworkLoading');
    expect(bulkActionFlow).toContain('validateAdminDangerousActionConfirmation');

    expect(redemptionPage).toContain('AdminBulkActionFlow');
    expect(redemptionPage).toContain('actionId="redemption.bulkDisable"');
    expect(redemptionPage).toContain('actionId="redemption.bulkDelete"');
    expect(redemptionPage).toContain('summary={formatBulkDisableResult}');
    expect(redemptionPage).toContain('summary={formatBulkDeleteResult}');
    expect(redemptionPage).not.toContain(
      "message.success(\n        t('admin.redemption.bulkDisableDone'",
    );
    expect(redemptionPage).not.toContain(
      "message.success(\n        t('admin.redemption.bulkDeleteDone'",
    );
  });

  it('uses a modal state machine for change request bulk operations', () => {
    const changeRequestsPage = readRepoFile('src/features/Admin/AdminChangeRequestsPage.tsx');
    const bulkActionFlow = readRepoFile('src/features/Admin/AdminBulkActionFlow.tsx');

    expect(changeRequestsPage).toContain('AdminBulkActionFlow');
    expect(changeRequestsPage).toContain('actionId="subscription.changeRequest.bulkApprove"');
    expect(changeRequestsPage).toContain('actionId="subscription.changeRequest.bulkReject"');
    expect(changeRequestsPage).toContain('summary={formatBulkApproveChangeRequestResult}');
    expect(changeRequestsPage).toContain('summary={formatBulkRejectChangeRequestResult}');
    expect(changeRequestsPage).toContain('progressDescription={t(');
    expect(changeRequestsPage).toContain("'admin.changeRequests.bulkApproveProgress'");
    expect(changeRequestsPage).toContain("'admin.changeRequests.bulkRejectProgress'");
    expect(changeRequestsPage).not.toContain('bulkRunning');
    expect(changeRequestsPage).not.toContain('bulkRejectOpen');
    expect(changeRequestsPage).not.toMatch(
      /message\.success\(\s*t\(\s*'admin\.changeRequests\.bulkApproveDone'/,
    );
    expect(changeRequestsPage).not.toMatch(
      /message\.success\(\s*t\(\s*'admin\.changeRequests\.bulkRejectDone'/,
    );

    expect(bulkActionFlow).not.toContain('reasonOptional?: boolean');
    expect(bulkActionFlow).toContain('requirement?.allowsReason');
    expect(changeRequestsPage).not.toContain('reasonOptional');
    expect(changeRequestsPage).toContain('onRun={handleBulkReject}');
  });

  it('keeps all selected-row admin bulk mutations on the shared state machine', () => {
    const redemptionPage = readRepoFile('src/routes/(main)/admin/redemption/index.tsx');
    const changeRequestsPage = readRepoFile('src/features/Admin/AdminChangeRequestsPage.tsx');
    const providersPage = readRepoFile('src/features/Admin/AdminProvidersPage.tsx');

    for (const page of [redemptionPage, changeRequestsPage]) {
      expect(page).toContain('rowSelection={{');
      expect(page).toContain('selectedIds');
      expect(page).toContain('AdminBulkActionFlow');
      expect(page).not.toContain('bulkRunning');
      expect(page).not.toContain('confirmLoading={bulkRunning}');
    }

    expect(providersPage).toContain('bulkText');
    expect(providersPage).toContain('admin.providers.models.bulkAddHint');
    expect(providersPage).not.toContain('rowSelection={{');
  });

  it('adds an order detail drawer for P2 operations review', () => {
    const ordersPage = readRepoFile('src/features/Admin/AdminOrdersPage.tsx');
    const service = readRepoFile('src/services/adminCommercial.ts');

    expect(ordersPage).toContain('orderDetailId');
    expect(ordersPage).toContain('adminCommercialService.getOrderDetail(orderDetailId');
    expect(ordersPage).toContain("t('admin.orders.viewDetail'");
    expect(ordersPage).toContain("t('admin.orders.detail.redemptionCode'");
    expect(ordersPage).toContain("'admin.orders.detail.auditHint'");
    expect(service).toContain('getOrderDetail = async (orderId: string)');
  });

  it('deep links order details into filtered audit logs', () => {
    const ordersPage = readRepoFile('src/features/Admin/AdminOrdersPage.tsx');
    const auditPage = readRepoFile('src/routes/(main)/admin/audit/index.tsx');

    expect(ordersPage).toContain("import { Link } from 'react-router'");
    expect(ordersPage).toContain('const buildOrderAuditUrl = (orderId: string) => {');
    expect(ordersPage).toContain("searchParams.set('resourceType', 'top_up_order')");
    expect(ordersPage).toContain("searchParams.set('resourceId', orderId)");
    expect(ordersPage).toContain('to={buildOrderAuditUrl(orderDetail.id)}');
    expect(ordersPage).toContain("t('admin.orders.detail.viewAudit'");

    expect(auditPage).toContain("import { useSearchParams } from 'react-router'");
    expect(auditPage).toContain('const [searchParams] = useSearchParams();');
    expect(auditPage).toContain('const [resourceTypeFilter, setResourceTypeFilter] = useState(');
    expect(auditPage).toContain("searchParams.get('resourceType') ?? ''");
    expect(auditPage).toContain('const [resourceIdFilter, setResourceIdFilter] = useState(');
    expect(auditPage).toContain("searchParams.get('resourceId') ?? ''");
  });
});
