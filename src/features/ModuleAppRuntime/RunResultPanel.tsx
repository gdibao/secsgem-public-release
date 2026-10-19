import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatModuleAppRunPreview } from './runtimeHelpers';

interface RunResultPanelProps {
  estimate?: {
    baseAiCredits: number;
    externalApiCostCredits?: number;
    fixedServiceFeeCredits?: number;
    multiplier: number;
    totalCredits: number;
  };
  run?: {
    artifactIds?: string[];
    billing?: {
      actualAiCredits?: number;
      chargedCredits?: number;
      externalApiCostCredits?: number;
      fixedServiceFeeCredits?: number;
      multiplier?: number;
    };
    output?: { model?: string; provider?: string };
    preview?: string;
    status: string;
  } | null;
}

const RunResultPanel = memo<RunResultPanelProps>(({ estimate, run }) => {
  const { t } = useTranslation('common');
  if (!run) {
    return (
      <section data-testid="module-app-run-result">
        {estimate && (
          <>
            <div>{t('moduleApps.billing.estimate', { credits: estimate.totalCredits })}</div>
            <div>{t('moduleApps.billing.baseAi', { credits: estimate.baseAiCredits })}</div>
            <div>
              {t('moduleApps.billing.fixedFee', {
                credits: estimate.fixedServiceFeeCredits ?? 0,
              })}
            </div>
            <div>
              {t('moduleApps.billing.externalApi', {
                credits: estimate.externalApiCostCredits ?? 0,
              })}
            </div>
          </>
        )}
        <div>{t('moduleApps.billing.noRun')}</div>
      </section>
    );
  }

  return (
    <section data-testid="module-app-run-result">
      <div>{formatModuleAppRunPreview(run)}</div>
      {estimate && <div>{t('moduleApps.billing.estimate', { credits: estimate.totalCredits })}</div>}
      <div>{t('moduleApps.billing.status', { status: run.status })}</div>
      <div>{t('moduleApps.billing.actual', { credits: run.billing?.chargedCredits ?? 0 })}</div>
      <div>{t('moduleApps.billing.baseAi', { credits: run.billing?.actualAiCredits ?? 0 })}</div>
      <div>
        {t('moduleApps.billing.fixedFee', {
          credits: run.billing?.fixedServiceFeeCredits ?? 0,
        })}
      </div>
      <div>
        {t('moduleApps.billing.externalApi', {
          credits: run.billing?.externalApiCostCredits ?? 0,
        })}
      </div>
      <div>{t('moduleApps.billing.multiplier', { value: run.billing?.multiplier ?? 1 })}</div>
      {run.output?.model && <div>{t('moduleApps.billing.model', { name: run.output.model })}</div>}
      {run.output?.provider && (
        <div>{t('moduleApps.billing.provider', { name: run.output.provider })}</div>
      )}
      <div>{t('moduleApps.billing.artifacts', { count: run.artifactIds?.length ?? 0 })}</div>
    </section>
  );
});

RunResultPanel.displayName = 'RunResultPanel';

export default RunResultPanel;
