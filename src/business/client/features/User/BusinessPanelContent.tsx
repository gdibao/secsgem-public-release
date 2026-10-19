import { Flexbox, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Crown, WalletCards } from 'lucide-react';

import {
  formatCredits,
  useBusinessSubscriptionProfile,
} from '@/business/client/BusinessSettingPages/shared';
import PlanIcon from '@/features/PlanIcon';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    margin-block: 4px;
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
  creditIcon: css`
    flex: none;
    color: ${cssVar.colorTextSecondary};
  `,
  creditLabel: css`
    font-size: 11px;
    line-height: 1.2;
    color: ${cssVar.colorTextDescription};
  `,
  creditValue: css`
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.25;
    color: ${cssVar.colorText};
  `,
  quota: css`
    margin-inline-start: auto;

    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextDescription};
    white-space: nowrap;
  `,
}));

export default function BusinessPanelContent() {
  const { accountSummary, currentPlan, subscriptionSummary } = useBusinessSubscriptionProfile();
  const subscription = accountSummary?.breakdown?.subscription;

  return (
    <Flexbox className={styles.container} gap={12}>
      <Flexbox horizontal align="center" justify="space-between">
        <Flexbox horizontal align="center" gap={8}>
          <PlanIcon plan={currentPlan} size={22} type="combine" />
        </Flexbox>
        <WorkspaceLink to="/settings/plans">
          <Button icon={Crown} size="small" type="primary">
            升级
          </Button>
        </WorkspaceLink>
      </Flexbox>
      <Flexbox horizontal align="center" gap={8}>
        <Icon className={styles.creditIcon} icon={WalletCards} size={16} />
        <Flexbox gap={2}>
          <span className={styles.creditLabel}>订阅积分</span>
          <span className={styles.creditValue}>{formatCredits(subscription?.available ?? 0)}</span>
        </Flexbox>
        <span className={styles.quota}>
          本周期额度 {formatCredits(subscriptionSummary?.monthlyCredits ?? 0)}
        </span>
      </Flexbox>
    </Flexbox>
  );
}
