import type { ModuleAppScopeType } from '@lobechat/types';
import { Segmented } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ScopeSwitchProps {
  onChange: (scopeType: ModuleAppScopeType) => void;
  scopeType: ModuleAppScopeType;
  workspaceId?: string;
}

const ScopeSwitch = memo<ScopeSwitchProps>(({ onChange, scopeType, workspaceId }) => {
  const { t } = useTranslation('common');

  return (
    <Segmented<ModuleAppScopeType>
      aria-label={t('moduleApps.runtime.scope.label')}
      data-testid="module-app-scope-switch"
      value={scopeType}
      options={[
        { label: t('moduleApps.runtime.scope.personal'), value: 'personal' },
        {
          disabled: !workspaceId,
          label: t('moduleApps.runtime.scope.workspace'),
          value: 'workspace',
        },
      ]}
      onChange={onChange}
    />
  );
});

ScopeSwitch.displayName = 'ScopeSwitch';

export default ScopeSwitch;
