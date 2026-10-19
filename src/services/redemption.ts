import { lambdaClient } from '@/libs/trpc/client';

class RedemptionService {
  preview = async (code: string) => lambdaClient.redemption.preview.query({ code });

  redeem = async (code: string) => lambdaClient.redemption.redeem.mutate({ code });
}

export const redemptionService = new RedemptionService();
