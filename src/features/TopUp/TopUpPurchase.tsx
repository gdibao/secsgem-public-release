'use client';

import type {
  PaymentCheckoutAction,
  PaymentMethod,
  PaymentMethodId,
  TopUpPackageItem,
} from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Segmented } from '@lobehub/ui/base-ui';
import { Alert, QRCode, Tag, Typography } from 'antd';
import { createStaticStyles } from 'antd-style';
import { CreditCard } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate } from 'swr';

import { refreshCommercialEntitlementState } from '@/business/client/commercialRefresh';
import { submitPaymentCheckout } from '@/features/Payments/checkout';
import { commercialService } from '@/services/commercial';

import {
  clearTopUpPaymentIntent,
  getOrCreateTopUpPaymentIntent,
  readTopUpPaymentIntent,
} from './paymentIntent';

const styles = createStaticStyles(({ css, cssVar }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
  `,
  packageButton: css`
    position: relative;

    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;

    min-height: 92px;
    padding: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorText};
    text-align: start;

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorPrimary};
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }

    &[data-selected='true'] {
      border-color: ${cssVar.colorPrimary};
      box-shadow: inset 0 0 0 1px ${cssVar.colorPrimary};
    }
  `,
}));

const displayCredits = (credits: number) => `${credits / 1_000_000}M`;
const CHECKOUT_RECOVERY_REQUIRED = 'TOP_UP_PAYMENT_CHECKOUT_RECOVERY_REQUIRED';
const TERMINAL_TOP_UP_PAYMENT_STATUSES = new Set(['canceled', 'expired', 'failed', 'refunded']);

const isTopUpCheckoutRecoveryRequired = (error: unknown) =>
  error instanceof Error && error.message.includes(CHECKOUT_RECOVERY_REQUIRED);

export const TopUpPurchase = () => {
  const { t } = useTranslation('subscription');
  const methods = useSWR<PaymentMethod[]>(['payment.getPaymentMethods'], () =>
    commercialService.getPaymentMethods(),
  );
  const packages = useSWR<TopUpPackageItem[]>(['commercial.listTopUpPackages'], () =>
    commercialService.getTopUpPackages(),
  );
  const cnyPackages = useMemo(
    () => (packages.data ?? []).filter((item) => item.currency === 'CNY'),
    [packages.data],
  );
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodId>();
  const [selectedPackage, setSelectedPackage] = useState<string>();
  const [checkout, setCheckout] = useState<PaymentCheckoutAction>();
  const [idempotencyKey, setIdempotencyKey] = useState<string>();
  const [paymentIntentRestored, setPaymentIntentRestored] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [orderId, setOrderId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const paymentStatus = useSWR(
    orderId ? ['payment.getPaymentStatus', orderId] : null,
    () => commercialService.getPaymentStatus(orderId!),
    {
      refreshInterval: (data) => (data?.status === 'pending' ? 2000 : 0),
      revalidateOnFocus: true,
    },
  );

  const recoverPayment = useCallback(
    async (key: string) => {
      setRecovering(true);
      setError(undefined);
      try {
        const recovered = await commercialService.recoverPaymentOrder(key);
        setOrderId(recovered.orderId);
        setRecoveryRequired(recovered.recoveryRequired);
        setCheckout(recovered.checkout?.type === 'qrcode' ? recovered.checkout : undefined);
      } catch {
        setError(
          t(
            'topup.online.recoveryFailed',
            'Unable to query the payment status. Please try again shortly.',
          ),
        );
      } finally {
        setRecovering(false);
      }
    },
    [t],
  );

  useEffect(() => {
    const intent = readTopUpPaymentIntent();
    if (intent) {
      setIdempotencyKey(intent.idempotencyKey);
      setSelectedMethod(intent.method);
      setSelectedPackage(intent.packageId);
      void recoverPayment(intent.idempotencyKey);
    }
    setPaymentIntentRestored(true);
  }, [recoverPayment]);

  useEffect(() => {
    if (!paymentIntentRestored) return;
    if (
      methods.data?.[0] &&
      (!selectedMethod || !methods.data.some((method) => method.id === selectedMethod))
    ) {
      setSelectedMethod(methods.data[0].id);
    }
  }, [methods.data, paymentIntentRestored, selectedMethod]);

  useEffect(() => {
    if (!paymentIntentRestored) return;
    if (
      cnyPackages[0] &&
      (!selectedPackage || !cnyPackages.some((item) => item.id === selectedPackage))
    ) {
      setSelectedPackage(cnyPackages.find((item) => item.recommended)?.id ?? cnyPackages[0].id);
    }
  }, [cnyPackages, paymentIntentRestored, selectedPackage]);

  useEffect(() => {
    if (!orderId || paymentStatus.data?.orderId !== orderId) return;
    if (paymentStatus.data.status === 'paid') {
      setCheckout(undefined);
      setRecoveryRequired(false);
      if (idempotencyKey) clearTopUpPaymentIntent(idempotencyKey);
      void Promise.all([
        refreshCommercialEntitlementState(),
        mutate(['commercial.getCreditAccountSummary']),
        mutate(['commercial.listBillingOrders']),
        mutate(['commercial.listCreditPackages']),
        mutate(['commercial.listTopUpOrders']),
      ]);
    } else if (TERMINAL_TOP_UP_PAYMENT_STATUSES.has(paymentStatus.data.status)) {
      setCheckout(undefined);
      setRecoveryRequired(false);
      if (idempotencyKey) {
        clearTopUpPaymentIntent(idempotencyKey);
        setIdempotencyKey(undefined);
      }
    }
  }, [idempotencyKey, orderId, paymentStatus.data?.orderId, paymentStatus.data?.status]);

  const submit = async () => {
    if (!selectedMethod || !selectedPackage) return;
    let activeIdempotencyKey = idempotencyKey;
    setSubmitting(true);
    setError(undefined);
    setRecoveryRequired(false);
    setCheckout(undefined);
    setOrderId(undefined);
    try {
      const intent = getOrCreateTopUpPaymentIntent({
        method: selectedMethod,
        packageId: selectedPackage,
      });
      activeIdempotencyKey = intent.idempotencyKey;
      setIdempotencyKey(intent.idempotencyKey);
      const payment = await commercialService.createPaymentOrder({
        idempotencyKey: intent.idempotencyKey,
        method: selectedMethod,
        packageId: selectedPackage,
      });
      setOrderId(payment.orderId);
      const action = submitPaymentCheckout(payment.checkout);
      setCheckout(action.type === 'qrcode' ? action : undefined);
    } catch (cause) {
      if (isTopUpCheckoutRecoveryRequired(cause)) {
        setRecoveryRequired(true);
        if (activeIdempotencyKey) await recoverPayment(activeIdempotencyKey);
      } else {
        setError(cause instanceof Error ? cause.message : 'TOP_UP_PAYMENT_CREATE_FAILED');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const methodOptions = (methods.data ?? []).map((item) => ({
    label: t(`topup.online.methods.${item.id}`, item.label),
    value: item.id,
  }));
  const statusMatchesOrder = Boolean(orderId && paymentStatus.data?.orderId === orderId);
  const paid = statusMatchesOrder && paymentStatus.data?.status === 'paid';
  const terminalFailure =
    statusMatchesOrder && TERMINAL_TOP_UP_PAYMENT_STATUSES.has(paymentStatus.data?.status ?? '');
  const awaitingPayment = Boolean(orderId && !paid && !terminalFailure);

  return (
    <section aria-labelledby="topup-online-title">
      <Flexbox gap={12}>
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={CreditCard} size={18} />
          <Typography.Title id="topup-online-title" level={4} style={{ margin: 0 }}>
            {t('topup.online.title', '在线充值')}
          </Typography.Title>
        </Flexbox>
        {error && <Alert showIcon message={error} type="error" />}
        {paid && <Alert showIcon message={t('topup.online.paid', '充值已到账')} type="success" />}
        {terminalFailure && (
          <Alert
            showIcon
            message={t('topup.online.failed', '支付未完成，请重新发起')}
            type="error"
          />
        )}
        {awaitingPayment && !recoveryRequired && (
          <Alert showIcon message={t('topup.online.pending', '等待支付确认')} type="info" />
        )}
        {recoveryRequired && !paid && !terminalFailure && (
          <Alert
            showIcon
            type="warning"
            action={
              <Button
                loading={recovering}
                size="small"
                onClick={() => idempotencyKey && void recoverPayment(idempotencyKey)}
              >
                {t('topup.online.queryStatus', '查询支付状态')}
              </Button>
            }
            message={t(
              'topup.online.recoveryPending',
              '支付订单已创建，请先查询支付状态，避免重复支付',
            )}
          />
        )}
        {!methods.isLoading && methodOptions.length === 0 && (
          <Alert showIcon message={t('topup.online.unavailable', '在线支付暂未开放')} type="info" />
        )}
        {!packages.isLoading && cnyPackages.length === 0 && (
          <Alert
            showIcon
            message={t('topup.online.noCnyPackages', '暂无可在线支付的人民币充值套餐')}
            type="warning"
          />
        )}
        {cnyPackages.length > 0 && (
          <div className={styles.grid}>
            {cnyPackages.map((item) => (
              <button
                className={styles.packageButton}
                data-selected={selectedPackage === item.id}
                disabled={awaitingPayment}
                key={item.id}
                type="button"
                onClick={() => {
                  setCheckout(undefined);
                  setError(undefined);
                  setRecoveryRequired(false);
                  if (idempotencyKey) clearTopUpPaymentIntent(idempotencyKey);
                  setIdempotencyKey(undefined);
                  setOrderId(undefined);
                  setSelectedPackage(item.id);
                }}
              >
                <Flexbox horizontal align="center" gap={6}>
                  <strong>{item.displayName ?? displayCredits(item.credits)}</strong>
                  {item.recommended && (
                    <Tag color="gold">{t('topup.online.recommended', '推荐')}</Tag>
                  )}
                </Flexbox>
                <Typography.Text type="secondary">
                  {displayCredits(item.credits)} · ¥{item.amount}
                </Typography.Text>
              </button>
            ))}
          </div>
        )}
        {methodOptions.length > 0 && (
          <Segmented
            block
            disabled={awaitingPayment}
            options={methodOptions}
            value={selectedMethod}
            onChange={(value) => {
              setCheckout(undefined);
              setError(undefined);
              setRecoveryRequired(false);
              if (idempotencyKey) clearTopUpPaymentIntent(idempotencyKey);
              setIdempotencyKey(undefined);
              setOrderId(undefined);
              setSelectedMethod(value as PaymentMethodId);
            }}
          />
        )}
        {checkout?.type === 'qrcode' && (
          <Flexbox align="center" gap={8}>
            <QRCode size={220} value={checkout.url} />
            <Typography.Text type="secondary">
              {t('topup.online.scan', '请使用微信扫码支付')}
            </Typography.Text>
          </Flexbox>
        )}
        <Button
          block
          disabled={!selectedMethod || !selectedPackage || paid || awaitingPayment}
          loading={submitting}
          size="large"
          type="primary"
          onClick={() => void submit()}
        >
          {paid ? t('topup.online.completed', '已完成') : t('topup.online.pay', '立即支付')}
        </Button>
      </Flexbox>
    </section>
  );
};
