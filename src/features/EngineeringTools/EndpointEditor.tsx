'use client';

import { Button, Checkbox, Input, Select } from '@lobehub/ui/base-ui';
import { Save, X } from 'lucide-react';
import { useState } from 'react';

import { workspaceStyles as styles } from './workspaceStyles';
import { endpointModeLabels, type EndpointWrite, type EngineeringEndpoint, licenseLabels, workspaceError } from './workspaceTypes';

interface Props {
  endpoint?: EngineeringEndpoint;
  onCancel: () => void;
  onSave: (draft: EndpointWrite) => Promise<unknown>;
  tools: { id: string; name: string }[];
}

const EndpointEditor = ({ endpoint, onCancel, onSave, tools }: Props) => {
  const [draft, setDraft] = useState<EndpointWrite>(() => endpoint ? {
    ...structuredClone(endpoint), expectedVersion: endpoint.version,
  } : {
    authPrerequisite: '', embedEvidence: null, enabled: false, hostedEvidence: null,
    licenseEvidence: null, licenseState: 'pending', mode: 'external_web', title: '', toolId: '', url: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const edit = <K extends keyof EndpointWrite>(key: K, value: EndpointWrite[K]) => setDraft((previous) => ({ ...previous, [key]: value }));
  const textField = (label: string, value: string, onChange: (value: string) => void, full = false) =>
    <label className={`${styles.field} ${full ? styles.full : ''}`}><span>{label}</span><Input disabled={busy} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
  const evidenceField = (kind: 'license' | 'embed' | 'hosted', field: 'checkedAt' | 'reference', value: string) => {
    const empty = { checkedAt: '', reference: '' };
    if (kind === 'license') edit('licenseEvidence', { ...(draft.licenseEvidence ?? empty), [field]: value });
    if (kind === 'embed') edit('embedEvidence', {
      ...(draft.embedEvidence ?? { browserLoginVerified: false, cspFrameAncestorsAllowed: false, xFrameOptionsAllowed: false, permission: empty }),
      permission: { ...(draft.embedEvidence?.permission ?? empty), [field]: value },
    });
    if (kind === 'hosted') edit('hostedEvidence', {
      ...(draft.hostedEvidence ?? { approvedOrigin: '', deploymentVerifiedAt: '', rights: empty }),
      rights: { ...(draft.hostedEvidence?.rights ?? empty), [field]: value },
    });
  };
  const frameCheck = (label: string, key: 'browserLoginVerified' | 'cspFrameAncestorsAllowed' | 'xFrameOptionsAllowed') =>
    <Checkbox checked={draft.embedEvidence?.[key] ?? false} disabled={busy} onChange={(checked) => edit('embedEvidence', {
      ...(draft.embedEvidence ?? { browserLoginVerified: false, cspFrameAncestorsAllowed: false, xFrameOptionsAllowed: false, permission: { checkedAt: '', reference: '' } }), [key]: checked,
    })}>{label}</Checkbox>;
  const save = async () => {
    setBusy(true); setError('');
    try {
      const { version: _version, ...input } = draft as EndpointWrite & { version?: number };
      await onSave(input);
    } catch (error) { setError(workspaceError(error)); }
    finally { setBusy(false); }
  };

  return <section aria-label="端点编辑" className={styles.editor}>
    <label className={styles.field}><span>关联工具</span><Select aria-label="端点关联工具" disabled={busy || !!endpoint} options={tools.map((tool) => ({ label: `${tool.name} · ${tool.id}`, value: tool.id }))} value={draft.toolId} onChange={(value) => edit('toolId', value ?? '')} /></label>
    {textField('端点名称', draft.title, (value) => edit('title', value))}
    <label className={styles.field}><span>接入方式</span><Select aria-label="端点接入方式" disabled={busy} options={Object.entries(endpointModeLabels).map(([value, label]) => ({ label, value }))} value={draft.mode} onChange={(value) => { if (value) edit('mode', value as EndpointWrite['mode']); }} /></label>
    <label className={styles.field}><span>许可状态</span><Select aria-label="端点许可状态" disabled={busy} options={Object.entries(licenseLabels).map(([value, label]) => ({ label, value }))} value={draft.licenseState} onChange={(value) => { if (value) edit('licenseState', value as EndpointWrite['licenseState']); }} /></label>
    {textField('工作 URL（HTTPS）', draft.url, (value) => edit('url', value), true)}
    {textField('认证与账号前提', draft.authPrerequisite, (value) => edit('authPrerequisite', value), true)}
    {textField('许可证据 URL', draft.licenseEvidence?.reference ?? '', (value) => evidenceField('license', 'reference', value))}
    {textField('许可核验时间（ISO 8601）', draft.licenseEvidence?.checkedAt ?? '', (value) => evidenceField('license', 'checkedAt', value))}
    {draft.mode === 'embedded_web' && <>
      <h3 className={styles.full}>工作区嵌入核验</h3>
      {textField('厂商嵌入许可证据 URL', draft.embedEvidence?.permission.reference ?? '', (value) => evidenceField('embed', 'reference', value))}
      {textField('嵌入核验时间（ISO 8601）', draft.embedEvidence?.permission.checkedAt ?? '', (value) => evidenceField('embed', 'checkedAt', value))}
      <div className={`${styles.toolbar} ${styles.full}`}>
        {frameCheck('浏览器登录已核验', 'browserLoginVerified')}
        {frameCheck('CSP frame-ancestors 允许', 'cspFrameAncestorsAllowed')}
        {frameCheck('X-Frame-Options 允许', 'xFrameOptionsAllowed')}
      </div>
    </>}
    {draft.mode === 'hosted_web' && <>
      <h3 className={styles.full}>企业托管核验</h3>
      <p className={styles.full} role="status">实时服务身份与健康尚未接通核验，企业托管入口当前不可启动。</p>
      {textField('部署与再分发权利证据 URL', draft.hostedEvidence?.rights.reference ?? '', (value) => evidenceField('hosted', 'reference', value))}
      {textField('权利核验时间（ISO 8601）', draft.hostedEvidence?.rights.checkedAt ?? '', (value) => evidenceField('hosted', 'checkedAt', value))}
      {textField('已批准托管 Origin', draft.hostedEvidence?.approvedOrigin ?? '', (value) => edit('hostedEvidence', { ...(draft.hostedEvidence ?? { deploymentVerifiedAt: '', rights: { checkedAt: '', reference: '' } }), approvedOrigin: value }))}
      {textField('历史部署核验时间（ISO 8601）', draft.hostedEvidence?.deploymentVerifiedAt ?? '', (value) => edit('hostedEvidence', { ...(draft.hostedEvidence ?? { approvedOrigin: '', rights: { checkedAt: '', reference: '' } }), deploymentVerifiedAt: value }))}
    </>}
    <div className={styles.full}><Checkbox checked={draft.enabled} disabled={busy} onChange={(checked) => edit('enabled', checked)}>启用端点</Checkbox></div>
    {error && <p className={styles.full} role="alert">{error}</p>}
    <div className={`${styles.toolbar} ${styles.full}`}>
      <Button disabled={!draft.title.trim() || !draft.toolId || !draft.url.trim()} icon={<Save size={16} />} loading={busy} type="primary" onClick={() => void save()}>保存端点</Button>
      <Button disabled={busy} icon={<X size={16} />} onClick={onCancel}>取消</Button>
    </div>
  </section>;
};

export default EndpointEditor;
