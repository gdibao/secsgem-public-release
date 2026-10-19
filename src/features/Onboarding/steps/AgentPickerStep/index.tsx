'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Undo2Icon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import LocalAssistantMarket from '@/features/LocalAssistantMarket';
import { localDomains } from '@/features/LocalAssistantMarket/catalog';
import {
  trackOnboardingCompleted,
  trackOnboardingStepCompleted,
} from '@/services/onboardingMetrics';
import { useUserStore } from '@/store/user';
import { consumeOnboardingCallbackUrl } from '@/utils/onboardingRedirect';

import LobeMessage from '../../components/LobeMessage';

interface AgentPickerStepProps {
  onBack: () => void;
}

const AgentPickerStep = memo<AgentPickerStepProps>(({ onBack }) => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isAgentSkipEntry = searchParams.get('entry') === 'skip';
  const [domainId, setDomainId] = useState<string>();
  const [finishing, setFinishing] = useState(false);
  const finishOnboarding = useUserStore((s) => s.finishOnboarding);
  const completionFlow = isAgentSkipEntry ? 'agent' : 'classic';

  const finish = useCallback(
    async (action: 'install' | 'later') => {
      if (finishing) return;
      setFinishing(true);
      await finishOnboarding();
      trackOnboardingStepCompleted({
        action,
        entry: isAgentSkipEntry ? 'agent_skip' : 'classic',
        flow: completionFlow,
        selectedCount: action === 'install' ? 1 : 0,
        step: 'local_assistant_directory',
        stepIndex: 4,
      });
      const targetUrl = consumeOnboardingCallbackUrl() || '/';
      trackOnboardingCompleted({ flow: completionFlow, targetUrl });
      navigate(targetUrl);
    },
    [completionFlow, finishOnboarding, finishing, isAgentSkipEntry, navigate],
  );

  if (domainId) {
    return (
      <Flexbox gap={16}>
        <Button
          data-testid="onboarding-local-domain-back"
          disabled={finishing}
          icon={Undo2Icon}
          type="text"
          onClick={() => setDomainId(undefined)}
        >
          {t('back')}
        </Button>
        <LocalAssistantMarket
          embedded
          initialDomain={domainId}
          onInstalled={() => finish('install')}
        />
        <Button
          data-testid="onboarding-local-later"
          disabled={finishing}
          type="text"
          onClick={() => void finish('later')}
        >
          {t('localAssistantOnboarding.later')}
        </Button>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={16}>
      <LobeMessage
        sentences={[t('localAssistantOnboarding.title'), t('localAssistantOnboarding.subtitle')]}
      />
      <div
        data-testid="onboarding-local-domains"
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        }}
      >
        {localDomains.map((domain) => (
          <Button
            data-domain-id={domain.id}
            data-testid="onboarding-local-domain"
            key={domain.id}
            onClick={() => setDomainId(domain.id)}
          >
            {domain.name}
          </Button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {!isAgentSkipEntry ? (
          <Button disabled={finishing} icon={Undo2Icon} type="text" onClick={onBack}>
            {t('back')}
          </Button>
        ) : (
          <span />
        )}
        <Button
          data-testid="onboarding-local-later"
          disabled={finishing}
          type="text"
          onClick={() => void finish('later')}
        >
          {t('localAssistantOnboarding.later')}
        </Button>
      </div>
    </Flexbox>
  );
});

AgentPickerStep.displayName = 'AgentPickerStep';

export default AgentPickerStep;
