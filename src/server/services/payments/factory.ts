import type { PaymentMethodId } from '@lobechat/types';

import type { ModuleAppPaymentAdapter } from '@/business/server/module-apps/payments/contracts';
import { AlipayModuleAppClient } from '@/server/services/moduleAppPayments/alipay/client';

import type { ServerPaymentConfig } from './config';
import { WechatPayClient } from './wechat';
import { ZPayClient } from './zpay';

const required = (value: string | undefined, errorCode: string) => {
  if (!value?.trim()) throw new Error(errorCode);
  return value.trim();
};

export const createPaymentAdapter = (
  config: ServerPaymentConfig,
  method: PaymentMethodId,
): ModuleAppPaymentAdapter => {
  switch (method) {
    case 'alipay': {
      if (!config.alipay.enabled || !config.alipay.configured) {
        throw new Error('PAYMENT_ALIPAY_NOT_AVAILABLE');
      }
      return new AlipayModuleAppClient({
        alipayPublicKey: required(
          config.alipay.alipayPublicKey,
          'PAYMENT_ALIPAY_VERIFICATION_KEY_REQUIRED',
        ),
        appId: required(config.alipay.appId, 'PAYMENT_ALIPAY_APP_ID_REQUIRED'),
        ...(config.alipay.certMode === 'certificate'
          ? {
              alipayRootCertSn: required(
                config.alipay.rootCertSn,
                'PAYMENT_ALIPAY_ROOT_CERT_SN_REQUIRED',
              ),
              appCertSn: required(config.alipay.appCertSn, 'PAYMENT_ALIPAY_APP_CERT_SN_REQUIRED'),
            }
          : {}),
        gateway: config.alipay.gateway,
        merchantPrivateKey: required(
          config.alipay.merchantPrivateKey,
          'PAYMENT_ALIPAY_PRIVATE_KEY_REQUIRED',
        ),
        sellerId: required(config.alipay.sellerId, 'PAYMENT_ALIPAY_SELLER_ID_REQUIRED'),
      });
    }
    case 'wechat_pay': {
      if (!config.wechat.enabled || !config.wechat.configured) {
        throw new Error('PAYMENT_WECHAT_NOT_AVAILABLE');
      }
      return new WechatPayClient({
        apiBaseUrl: config.wechat.apiBaseUrl,
        apiV3Key: required(config.wechat.apiV3Key, 'PAYMENT_WECHAT_API_V3_KEY_REQUIRED'),
        appId: required(config.wechat.appId, 'PAYMENT_WECHAT_APP_ID_REQUIRED'),
        mchId: required(config.wechat.mchId, 'PAYMENT_WECHAT_MCH_ID_REQUIRED'),
        merchantPrivateKey: required(
          config.wechat.merchantPrivateKey,
          'PAYMENT_WECHAT_PRIVATE_KEY_REQUIRED',
        ),
        merchantSerialNo: required(
          config.wechat.merchantSerialNo,
          'PAYMENT_WECHAT_SERIAL_NO_REQUIRED',
        ),
        platformCertificate: required(
          config.wechat.platformCertificate,
          'PAYMENT_WECHAT_PLATFORM_CERTIFICATE_REQUIRED',
        ),
        platformCertificateSerialNo: required(
          config.wechat.platformCertificateSerialNo,
          'PAYMENT_WECHAT_PLATFORM_CERTIFICATE_SERIAL_NO_REQUIRED',
        ),
      });
    }
    case 'zpay_alipay':
    case 'zpay_wechat': {
      if (
        !config.zpay.enabled ||
        !config.zpay.configured ||
        (method === 'zpay_alipay' && !config.zpay.alipayEnabled) ||
        (method === 'zpay_wechat' && !config.zpay.wechatEnabled)
      ) {
        throw new Error('PAYMENT_ZPAY_NOT_AVAILABLE');
      }
      return new ZPayClient({
        apiBaseUrl: config.zpay.apiBaseUrl,
        merchantId: required(config.zpay.merchantId, 'PAYMENT_ZPAY_MERCHANT_ID_REQUIRED'),
        merchantKey: required(config.zpay.merchantKey, 'PAYMENT_ZPAY_MERCHANT_KEY_REQUIRED'),
        method,
      });
    }
  }
};
