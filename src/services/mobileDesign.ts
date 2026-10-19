import { lambdaClient } from '@/libs/trpc/client';

class MobileDesignService {
  getRecent(limit = 20) {
    return lambdaClient.mobileDesign.getRecent.query({ limit });
  }
}

export const mobileDesignService = new MobileDesignService();
