import type {
  PaymentCreateResult,
  PaymentMethod,
  PaymentMethodId,
  Plans,
  SubscriptionCycleType,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import {
  type BindReferralCodeParams,
  type QueryCommercialListParams,
  type QueryCreditLedgerParams,
  type UpdateAutoTopUpSettingParams,
  type UpdateReferralCodeParams,
} from '@/types/business';

class CommercialService {
  getOverview = async () => {
    return lambdaClient.subscription.getOverview.query();
  };

  getSubscriptionSummary = async () => {
    return lambdaClient.subscription.getSummary.query();
  };

  getPendingSubscriptionChangeRequest = async () => {
    return lambdaClient.subscription.getPendingChangeRequest.query();
  };

  listSubscriptionChangeRequests = async (params?: QueryCommercialListParams) => {
    return lambdaClient.subscription.listChangeRequests.query(params ?? {});
  };

  listPlanCatalog = async () => {
    return lambdaClient.subscription.listPlanCatalog.query();
  };

  listPlanFaq = async () => {
    return lambdaClient.subscription.listPlanFaq.query();
  };

  getCreditAccountSummary = async () => {
    return lambdaClient.spend.getAccountSummary.query();
  };

  getAutoTopUpSetting = async () => {
    return lambdaClient.spend.getAutoTopUpSetting.query();
  };

  getResourceUsage = async () => {
    return lambdaClient.spend.getResourceUsage.query();
  };

  listCreditLedger = async (params?: QueryCreditLedgerParams) => {
    return lambdaClient.spend.listLedger.query(params ?? {});
  };

  listCreditPackages = async (params?: QueryCommercialListParams) => {
    return lambdaClient.spend.listCreditPackages.query(params ?? {});
  };

  listBillingOrders = async (params?: QueryCommercialListParams) => {
    return lambdaClient.spend.listBillingOrders.query(params ?? {});
  };

  updateAutoTopUpSetting = async (params: UpdateAutoTopUpSettingParams) => {
    return lambdaClient.spend.updateAutoTopUpSetting.mutate(params);
  };

  getReferralOverview = async () => {
    return lambdaClient.referral.getOverview.query();
  };

  activateReferralReward = async () => {
    return lambdaClient.referral.activateReward.mutate();
  };

  updateReferralCode = async (params: UpdateReferralCodeParams) => {
    return lambdaClient.referral.updateCode.mutate(params);
  };

  bindReferralCode = async (params: BindReferralCodeParams) => {
    return lambdaClient.referral.bindCode.mutate(params);
  };

  listReferralHistory = async (params?: QueryCommercialListParams) => {
    return lambdaClient.referral.listHistory.query(params ?? {});
  };

  getTopUpPackages = async () => {
    return lambdaClient.spend.listTopUpPackages.query();
  };

  getPaymentMethods = async () =>
    lambdaClient.payment.getPaymentMethods.query() as Promise<PaymentMethod[]>;

  createPaymentOrder = async (input: {
    idempotencyKey: string;
    method?: PaymentMethodId;
    packageId: string;
  }) =>
    lambdaClient.payment.createPaymentOrder.mutate(input) as Promise<
      PaymentCreateResult & { orderId: string }
    >;

  getSubscriptionPaymentMethods = async () =>
    lambdaClient.payment.getSubscriptionPaymentMethods.query() as Promise<PaymentMethod[]>;

  createSubscriptionPaymentOrder = async (input: {
    cycle: SubscriptionCycleType;
    idempotencyKey: string;
    method?: PaymentMethodId;
    plan: Plans;
  }) =>
    lambdaClient.payment.createSubscriptionPaymentOrder.mutate(input) as Promise<
      PaymentCreateResult & { orderId: string }
    >;

  getSubscriptionPaymentStatus = async (orderId: string) =>
    lambdaClient.payment.getSubscriptionPaymentStatus.query({ orderId });

  recoverSubscriptionPaymentOrder = async (idempotencyKey: string) =>
    lambdaClient.payment.recoverSubscriptionPaymentOrder.mutate({ idempotencyKey });

  getPaymentStatus = async (orderId: string) =>
    lambdaClient.payment.getPaymentStatus.query({ orderId });

  recoverPaymentOrder = async (idempotencyKey: string) =>
    lambdaClient.payment.recoverPaymentOrder.mutate({ idempotencyKey });

  listTopUpOrders = async (params?: QueryCommercialListParams) => {
    return lambdaClient.spend.listTopUpOrders.query(params ?? {});
  };

  redeemCode = async (code: string) => {
    return lambdaClient.redemption.redeem.mutate({ code });
  };

  previewCode = async (code: string) => {
    return lambdaClient.redemption.preview.query({ code });
  };
}

export const commercialService = new CommercialService();
