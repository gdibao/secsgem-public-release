import { Alert } from 'antd';
import { toast } from '@lobehub/ui/base-ui';

import type { BaseSignUpFormValues } from '@/features/Auth/SignUp/types';

import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

export interface BusinessSignupFomData {
  phone?: string;
}

// eslint-disable-next-line unused-imports/no-unused-vars
export const useBusinessSignup = (form: any) => {
  const { data } = useClientDataSWR(['public-growth-settings'], () =>
    adminCommercialService.getPublicGrowth(),
  );
  const signupClosed = data?.signup.enabled === false;
  const signupClosedMessage = data?.signup.disabledMessage || 'Registration is temporarily closed.';

  return {
    businessElement: signupClosed ? (
      <Alert showIcon message={signupClosedMessage} style={{ marginBottom: 16 }} type="warning" />
    ) : null,
    // eslint-disable-next-line unused-imports/no-unused-vars
    getCaptchaTokenOnError: async (error: unknown) => undefined as string | null | undefined,
    getFetchOptions: async () => {
      return {};
    },
    // eslint-disable-next-line unused-imports/no-unused-vars
    preSocialSignupCheck: async (values: BusinessSignupFomData & BaseSignUpFormValues) => {
      if (signupClosed) {
        toast.warning(signupClosedMessage);
        return false;
      }

      return true;
    },
    phoneEnabled: data?.signup.phoneEnabled === true,
  };
};
