import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import { ChatErrorType, type ChatMessageError } from '@lobechat/types';
import { Button, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import ErrorContent from '@/features/Conversation/ChatItem/components/ErrorContent';
import { useProviderName } from '@/hooks/useProviderName';

const useStyles = createStaticStyles(({ css }) => ({
  meta: css`
    color: ${cssVar.colorTextDescription};
    font-size: 13px;
    line-height: 1.6;
  `,
  statGrid: css`
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
    width: 100%;
  `,
  statItem: css`
    background: ${cssVar.colorFillQuaternary};
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    padding: 10px 12px;
  `,
  statLabel: css`
    color: ${cssVar.colorTextSecondary};
    font-size: 12px;
    line-height: 1.5;
  `,
  statValue: css`
    color: ${cssVar.colorText};
    font-size: 16px;
    font-weight: 700;
    line-height: 1.5;
    margin-top: 4px;
  `,
}));

interface CommercialBudgetErrorBody {
  availableCredits?: number;
  model?: string;
  provider?: string;
  requiredCredits?: number;
  shortfallCredits?: number;
}
const toFiniteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const formatBusinessNumber = (value: number) =>
  new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 6,
  }).format(value);

const formatCredits = (value: number) => `${formatBusinessNumber(value / CREDITS_PER_DOLLAR)} M`;

interface BusinessChatErrorMessageExtraOptions {
  /**
   * Retry for the failed turn, resolved by the render surface. Business cards
   * must use it instead of deriving a retry from `messageId`: on the group
   * surface (a multi-step run) `messageId` is a nested content block, which the
   * message-level store actions cannot resolve.
   */
  onRetry?: () => void;
}

export default function useRenderBusinessChatErrorMessageExtra(
  error: ChatMessageError | null | undefined,
  messageId: string,
  options?: BusinessChatErrorMessageExtraOptions,
) {
  const { t } = useTranslation('subscription');
  const navigate = useNavigate();
  const providerName = useProviderName(
    error?.body && typeof error.body === 'object'
      ? ((error.body as CommercialBudgetErrorBody).provider ?? '')
      : '',
  );

  const budgetError = useMemo(() => {
    if (error?.type !== ChatErrorType.InsufficientBudgetForModel) return undefined;
    if (!error.body || typeof error.body !== 'object') return {};

    const body = error.body as CommercialBudgetErrorBody;

    return {
      availableCredits: toFiniteNumber(body.availableCredits),
      model: typeof body.model === 'string' ? body.model : undefined,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      requiredCredits: toFiniteNumber(body.requiredCredits),
      shortfallCredits: toFiniteNumber(body.shortfallCredits),
    };
  }, [error]);

  if (!budgetError) return null;

  const providerModel =
    budgetError.model && providerName
      ? `${providerName} / ${budgetError.model}`
      : budgetError.model || providerName;

  return (
    <ErrorContent
      id={messageId}
      onRegenerate={options?.onRetry}
      error={{
        action: (
          <Flexbox horizontal gap={8} wrap={'wrap'}>
            <Button size={'small'} type={'primary'} onClick={() => navigate('/settings/billing')}>
              {t('billing.redeem.title')}
            </Button>
            <Button size={'small'} onClick={() => navigate('/settings/plans')}>
              {t('comparePlans')}
            </Button>
          </Flexbox>
        ),
        description: (
          <Flexbox gap={12}>
            <div className={useStyles.meta}>{t('limitation.insufficientBudget.desc')}</div>
            {providerModel ? <div className={useStyles.meta}>{providerModel}</div> : null}
            <div className={useStyles.statGrid}>
              {budgetError.availableCredits !== undefined ? (
                <div className={useStyles.statItem}>
                  <div className={useStyles.statLabel}>{t('balance.creditBalance')}</div>
                  <div className={useStyles.statValue}>
                    {formatCredits(budgetError.availableCredits)}
                  </div>
                </div>
              ) : null}
              {budgetError.requiredCredits !== undefined ? (
                <div className={useStyles.statItem}>
                  <div className={useStyles.statLabel}>
                    {t('limitation.insufficientBudget.required')}
                  </div>
                  <div className={useStyles.statValue}>
                    {formatCredits(budgetError.requiredCredits)}
                  </div>
                </div>
              ) : null}
              {budgetError.shortfallCredits !== undefined ? (
                <div className={useStyles.statItem}>
                  <div className={useStyles.statLabel}>
                    {t('limitation.insufficientBudget.shortfall')}
                  </div>
                  <div className={useStyles.statValue}>
                    {formatCredits(budgetError.shortfallCredits)}
                  </div>
                </div>
              ) : null}
            </div>
          </Flexbox>
        ),
        message: t('limitation.insufficientBudget.title'),
        type: 'warning',
      }}
    />
  );
}
