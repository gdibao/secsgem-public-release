'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Descriptions, Input, message, Tag } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { redemptionService } from '@/services/redemption';

interface PreviewState {
  creditsAmount: number | null;
  found: boolean;
  planCycle: string | null;
  planDurationMonths: number | null;
  planKey: string | null;
  rewardType: 'plan' | 'credits' | 'topup_package' | null;
  status: string | null;
  topupPackageId: string | null;
}

const rewardTypeLabel: Record<string, string> = {
  credits: '积分',
  plan: '套餐',
  topup_package: '充值包',
};

const statusLabel: Record<string, string> = {
  active: '可兑换',
  disabled: '已停用',
  expired: '已过期',
  redeemed: '已兑换',
};

const RedemptionPanel = memo<{ onSuccess?: () => void }>(({ onSuccess }) => {
  const { t } = useTranslation('subscription');
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCheck = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);
    try {
      const r = (await redemptionService.preview(trimmed)) as any;
      if (!r.found) {
        setPreview({ found: false } as any);
      } else {
        setPreview({
          creditsAmount: r.creditsAmount ?? null,
          found: true,
          planCycle: r.planCycle ?? null,
          planDurationMonths: r.planDurationMonths ?? null,
          planKey: r.planKey ?? null,
          rewardType: r.rewardType ?? null,
          status: r.status ?? null,
          topupPackageId: r.topupPackageId ?? null,
        });
      }
    } catch {
      message.error(t('billing.redeem.previewFailed', '查询兑换码失败'));
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);
    try {
      const r = await redemptionService.redeem(trimmed);
      message.success(t('billing.redeem.success', `兑换成功：${r.reward}`));
      setCode('');
      setPreview(null);
      onSuccess?.();
    } catch (err: any) {
      const msg = err?.message ?? '';
      const errorMap: Record<string, string> = {
        CODE_ALREADY_REDEEMED: t('billing.redeem.alreadyRedeemed', '兑换码已被使用'),
        CODE_DISABLED: t('billing.redeem.disabled', '兑换码已停用'),
        CODE_EXPIRED: t('billing.redeem.expired', '兑换码已过期'),
        CODE_NOT_FOUND: t('billing.redeem.notFound', '兑换码不存在'),
        CODE_RACE: t('billing.redeem.race', '兑换码已被使用'),
      };
      const matched = Object.keys(errorMap).find((k) => msg.includes(k));
      message.error(matched ? errorMap[matched] : t('billing.redeem.failed', '兑换失败'));
    } finally {
      setLoading(false);
    }
  };

  const canRedeem = preview?.found && preview.status === 'active';

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align="center" gap={8}>
        <Input
          placeholder={t('billing.redeem.placeholder', '输入兑换码')}
          style={{ maxWidth: 360 }}
          value={code}
          onPressEnter={handleCheck}
          onChange={(e: { target: { value: string } }) => {
            setCode(e.target.value);
            setPreview(null);
          }}
        />
        <Button loading={loading} onClick={handleCheck}>
          {t('billing.redeem.check', '查询')}
        </Button>
        <Button disabled={!canRedeem} loading={loading} type="primary" onClick={handleRedeem}>
          {t('billing.redeem.redeem', '兑换')}
        </Button>
      </Flexbox>

      {preview && !preview.found && (
        <Alert showIcon message={t('billing.redeem.notFound', '兑换码不存在')} type="error" />
      )}
      {preview?.found && (
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label={t('billing.redeem.type', '奖励类型')}>
            <Tag color="blue">{preview.rewardType ? rewardTypeLabel[preview.rewardType] : '-'}</Tag>
          </Descriptions.Item>
          {preview.rewardType === 'plan' && (
            <Descriptions.Item label={t('billing.redeem.plan', '套餐')}>
              {preview.planKey} / {preview.planCycle}
              {preview.planDurationMonths ? ` / ${preview.planDurationMonths} 个月` : ''}
            </Descriptions.Item>
          )}
          {preview.rewardType === 'credits' && (
            <Descriptions.Item label={t('billing.redeem.credits', '积分')}>
              {preview.creditsAmount}
            </Descriptions.Item>
          )}
          {preview.rewardType === 'topup_package' && (
            <Descriptions.Item label={t('billing.redeem.package', '充值包')}>
              {preview.topupPackageId}
            </Descriptions.Item>
          )}
          <Descriptions.Item label={t('billing.redeem.status', '状态')}>
            <Tag
              color={
                preview.status === 'active'
                  ? 'green'
                  : preview.status === 'redeemed'
                    ? 'blue'
                    : preview.status === 'expired'
                      ? 'orange'
                      : 'default'
              }
            >
              {preview.status ? statusLabel[preview.status] || preview.status : '-'}
            </Tag>
          </Descriptions.Item>
        </Descriptions>
      )}
    </Flexbox>
  );
});

RedemptionPanel.displayName = 'RedemptionPanel';

export default RedemptionPanel;
