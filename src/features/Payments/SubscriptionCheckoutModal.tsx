'use client';

import type {
  PaymentCheckoutAction,
  PaymentMethod,
  PaymentMethodId,
  Plans,
  SubscriptionCycleType,
} from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button, Modal, Segmented } from '@lobehub/ui/base-ui';
import { Alert, QRCode, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate } from 'swr';

import { refreshCommercialEntitlementState } from '@/business/client/commercialRefresh';
import { commercialService } from '@/services/commercial';

import { submitPaymentCheckout } from './checkout';
import {
  clearSubscriptionPaymentIntent,
  getOrCreateSubscriptionPaymentIntent,
  readSubscriptionPaymentIntent,
} from './subscriptionIntent';

export interface SubscriptionCheckoutTarget {
  cycle: SubscriptionCycleType;
  displayName: string;
  plan: Plans;
  priceLabel: string;
}

interface SubscriptionCheckoutModalProps {
  onClose: () => void;
  target?: SubscriptionCheckoutTarget;
}

const TERMINAL_SUBSCRIPTION_PAYMENT_STATUSES = new Set([
  'canceled',
  'expired',
  'failed',
  'refunded',
]);

export const SubscriptionCheckoutModal = ({ onClose, target }: SubscriptionCheckoutModalProps) => {
  const { t } = useTranslation('subscription');
  const targetCycle = target?.cycle;
  const targetPlan = target?.plan;
  const targetKey = targetPlan && targetCycle ? `${targetPlan}:${targetCycle}` : undefined;
  const targetKeyRef = useRef(targetKey);
  targetKeyRef.current = targetKey;
  const methods = useSWR<PaymentMethod[]>(
    target ? ['payment.getSubscriptionPaymentMethods'] : null,
    () => commercialService.getSubscriptionPaymentMethods(),
  );
  const [method, setMethod] = useState<PaymentMethodId>();
  const [checkout, setCheckout] = useState<PaymentCheckoutAction>();
  const [idempotencyKey, setIdempotencyKey] = useState<string>();
  const [orderId, setOrderId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<string>();
  const status = useSWR(
    orderId ? ['payment.getSubscriptionPaymentStatus', orderId] : null,
    () => commercialService.getSubscriptionPaymentStatus(orderId!),
    { refreshInterval: (data) => (data?.status === 'pending' ? 2000 : 0) },
  );

  const recover = useCallback(async (key: string, expectedTargetKey = targetKeyRef.current) => {
    setRecovering(true);
    setError(undefined);
    try {
      const result = await commercialService.recoverSubscriptionPaymentOrder(key);
      if (targetKeyRef.current !== expectedTargetKey) return;
      setOrderId(result.orderId);
      setCheckout(result.checkout?.type === 'qrcode' ? result.checkout : undefined);
    } catch (cause) {
      if (targetKeyRef.current !== expectedTargetKey) return;
      setError(cause instanceof Error ? cause.message : 'SUBSCRIPTION_PAYMENT_RECOVERY_FAILED');
    } finally {
      if (targetKeyRef.current === expectedTargetKey) setRecovering(false);
    }
  }, []);

  useEffect(() => {
    setCheckout(undefined);
    setError(undefined);
    setIdempotencyKey(undefined);
    setMethod(undefined);
    setOrderId(undefined);
    setRecovering(false);
    setSubmitting(false);
    if (!targetPlan || !targetCycle || !targetKey) return;
    const intent = readSubscriptionPaymentIntent();
    if (intent?.plan === targetPlan && intent.cycle === targetCycle) {
      setIdempotencyKey(intent.idempotencyKey);
      void recover(intent.idempotencyKey, targetKey);
    }
  }, [recover, targetCycle, targetKey, targetPlan]);

  useEffect(() => {
    if (!targetPlan || !targetCycle || !methods.data?.[0]) return;
    if (method && methods.data.some((item) => item.id === method)) return;
    const intent = readSubscriptionPaymentIntent();
    const restoredMethod =
      intent?.plan === targetPlan &&
      intent.cycle === targetCycle &&
      methods.data.some((item) => item.id === intent.method)
        ? intent.method
        : undefined;
    setMethod(restoredMethod ?? methods.data[0].id);
  }, [method, methods.data, targetCycle, targetPlan]);

  const paymentStatus = status.data?.status;
  const statusMatchesOrder = Boolean(orderId && status.data?.orderId === orderId);
  const terminalFailure =
    statusMatchesOrder && TERMINAL_SUBSCRIPTION_PAYMENT_STATUSES.has(paymentStatus ?? '');

  useEffect(() => {
    if (!statusMatchesOrder) return;
    if (paymentStatus === 'paid') {
      if (idempotencyKey) clearSubscriptionPaymentIntent(idempotencyKey);
      setCheckout(undefined);
      void Promise.all([
        refreshCommercialEntitlementState(),
        mutate(['commercial.listBillingOrders']),
        mutate(['commercial.listCreditPackages']),
      ]);
      return;
    }
    if (!TERMINAL_SUBSCRIPTION_PAYMENT_STATUSES.has(paymentStatus ?? '')) return;
    if (idempotencyKey) clearSubscriptionPaymentIntent(idempotencyKey);
    setCheckout(undefined);
    setIdempotencyKey(undefined);
  }, [idempotencyKey, paymentStatus, statusMatchesOrder]);

  const submit = async () => {
    if (!target || !method) return;
    const expectedTargetKey = targetKey;
    setSubmitting(true);
    setError(undefined);
    setCheckout(undefined);
    setOrderId(undefined);
    try {
      const intent = getOrCreateSubscriptionPaymentIntent({
        cycle: target.cycle,
        method,
        plan: target.plan,
      });
      setIdempotencyKey(intent.idempotencyKey);
      const payment = await commercialService.createSubscriptionPaymentOrder({
        cycle: target.cycle,
        idempotencyKey: intent.idempotencyKey,
        method,
        plan: target.plan,
      });
      if (targetKeyRef.current !== expectedTargetKey) return;
      setOrderId(payment.orderId);
      const action = submitPaymentCheckout(payment.checkout);
      setCheckout(action.type === 'qrcode' ? action : undefined);
    } catch (cause) {
      if (targetKeyRef.current !== expectedTargetKey) return;
      setError(cause instanceof Error ? cause.message : 'SUBSCRIPTION_PAYMENT_CREATE_FAILED');
    } finally {
      if (targetKeyRef.current === expectedTargetKey) setSubmitting(false);
    }
  };

  const paid = statusMatchesOrder && paymentStatus === 'paid';

  return (
    <Modal
      destroyOnHidden
      footer={null}
      open={Boolean(target)}
      title={target ? `${target.displayName} · ${target.priceLabel}` : ''}
      onCancel={onClose}
    >
      <Flexbox gap={12}>
        {error && <Alert showIcon message={error} type="error" />}
        {paid && <Alert showIcon message={t('plans.payment.paid', '套餐已生效')} type="success" />}
        {terminalFailure && !paid && (
          <Alert
            showIcon
            message={t('plans.payment.failed', '支付未完成，请重新发起')}
            type="error"
          />
        )}
        {!methods.isLoading && !methods.data?.length && (
          <Alert
            showIcon
            message={t('plans.payment.unavailable', '套餐在线支付暂未开放')}
            type="info"
          />
        )}
        {Boolean(methods.data?.length) && (
          <Segmented
            block
            disabled={Boolean(orderId && !paid && !terminalFailure)}
            options={methods.data!.map((item) => ({ label: item.label, value: item.id }))}
            value={method}
            onChange={(value) => setMethod(value as PaymentMethodId)}
          />
        )}
        {checkout?.type === 'qrcode' && (
          <Flexbox align="center" gap={8}>
            <QRCode size={220} value={checkout.url} />
            <Typography.Text type="secondary">
              {t('plans.payment.scan', '请使用微信扫码支付')}
            </Typography.Text>
          </Flexbox>
        )}
        {orderId && !paid && !terminalFailure && (
          <Alert
            showIcon
            message={t('plans.payment.pending', '等待支付确认')}
            type="info"
            action={
              <Button
                loading={recovering}
                size="small"
                onClick={() => idempotencyKey && void recover(idempotencyKey)}
              >
                {t('plans.payment.query', '查询状态')}
              </Button>
            }
          />
        )}
        <Button
          block
          disabled={!method || paid || Boolean(orderId && !terminalFailure)}
          loading={submitting}
          size="large"
          type="primary"
          onClick={() => void submit()}
        >
          {paid ? t('plans.payment.completed', '已完成') : t('plans.payment.pay', '立即支付')}
        </Button>
      </Flexbox>
    </Modal>
  );
};
