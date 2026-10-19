'use client';

import { Button, Select } from '@lobehub/ui/base-ui';

import { useEngineeringWorkspaceScope, useFetchToolEndpoints } from './useEngineeringWorkspace';
import { endpointModeLabels, endpointReasonLabels } from './workspaceTypes';

const EndpointPreference = ({ toolId, value, onChange, disabled }: { toolId: string; value: string | null; onChange: (value: string | null) => void; disabled?: boolean }) => {
  const { data, error, isLoading, mutate } = useFetchToolEndpoints(toolId);
  const { ready } = useEngineeringWorkspaceScope();
  const stale = value && data && !data.some((endpoint) => endpoint.id === value);
  return <>
    <label><span>默认启动入口</span><Select disabled={!ready || disabled || isLoading || !!error} value={value ?? ''} options={[
      { label: '每次选择', value: '' },
      ...(data ?? []).filter((endpoint) => endpoint.id !== null).map((endpoint) => ({ disabled: !endpoint.available, label: `${endpoint.title} · ${endpointModeLabels[endpoint.mode]}${endpoint.reason ? ` · ${endpointReasonLabels[endpoint.reason]}` : ''}`, value: endpoint.id! })),
      ...(stale ? [{ label: '已保存入口失效', value: value!, disabled: true }] : []),
    ]} onChange={(next) => onChange(next || null)} /></label>
    {error && <Button onClick={() => void mutate()}>入口加载失败，重试</Button>}
  </>;
};

export default EndpointPreference;
