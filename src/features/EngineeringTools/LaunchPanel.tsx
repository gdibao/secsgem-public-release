'use client';

import { Button, Select } from '@lobehub/ui/base-ui';
import { ExternalLink, Play, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import { engineeringWorkspaceService as service, type LaunchResult } from '@/services/engineeringWorkspace';

import { useEngineeringWorkspaceScope, useFetchToolEndpoints } from './useEngineeringWorkspace';
import { workspaceStyles as styles } from './workspaceStyles';
import { endpointModeLabels, endpointReasonLabels, licenseLabels, workspaceError } from './workspaceTypes';

interface Props {
  active?: boolean;
  defaultEndpointId?: string | null;
  onEndpointChange?: (endpointId: string | null) => void;
  toolId: string;
  toolName: string;
}

// L2-1（pilot-implementation-rev2 §2 / ui-ux-spec A-07/A-08）：嵌入帧加载失败降级兜底。
// 依据 P4 round2 实测 ETB 慢加载（20s 预算曾 TIMEOUT），预算取 60s。
const FRAME_TIMEOUT_MS = 60_000;

const LaunchPanel = ({ active = true, defaultEndpointId, onEndpointChange, toolId, toolName }: Props) => {
  const { data, error, isLoading, mutate } = useFetchToolEndpoints(toolId);
  const { ready } = useEngineeringWorkspaceScope();
  const [selected, setSelected] = useState(defaultEndpointId ?? '');
  const [result, setResult] = useState<LaunchResult>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [reactivating, setReactivating] = useState(false);
  // L2-1：嵌入帧降级态（超时/加载错误共用；外链态不适用）。
  const [frameFailed, setFrameFailed] = useState(false);
  const requestId = useRef(0);
  const wasActive = useRef(active);
  const returning = active && !wasActive.current;
  const resultRef = useRef(result);
  resultRef.current = result;
  const currentScope = useRef({ data, error, ready });
  currentScope.current = { data, error, ready };
  const endpoint = data?.find((item) => (item.id ?? '') === selected);
  const unavailableDefault = !!selected && data !== undefined && !endpoint;
  const canLaunch = active && !returning && !reactivating && ready && !!endpoint?.available && !error;
  const authorizedResult = result && result.toolId === toolId && ready && !error && data?.some((item) =>
    item.id === result.endpointId && item.revision === result.revision && item.available) ? result : undefined;
  const visibleResult = active && !returning && !reactivating ? authorizedResult : undefined;
  useEffect(() => {
    const shouldRevalidate = active && !wasActive.current;
    wasActive.current = active;
    if (!shouldRevalidate) return;
    let cancelled = false;
    setReactivating(true);
    void mutate().then((fresh) => {
      if (cancelled) return;
      const current = resultRef.current;
      if (current && !fresh?.some((item) => item.id === current.endpointId &&
        item.revision === current.revision && item.available)) setResult(undefined);
      setReactivating(false);
    }).catch(() => { if (!cancelled) setReactivating(false); });
    return () => { cancelled = true; };
  }, [active, mutate]);
  const close = () => { requestId.current += 1; setResult(undefined); setFailure(''); setBusy(false); setFrameFailed(false); };
  // L2-1：结果撤回/关闭时同步复位降级态。
  useEffect(() => {
    if (active && !reactivating && result && !authorizedResult) {
      requestId.current += 1;
      setResult(undefined);
      setBusy(false);
      setFrameFailed(false);
    }
  }, [active, authorizedResult, reactivating, result]);
  // L2-1（ui-ux-spec A-07 / rev2 §2 L2-1）：嵌入页 60s 未完成加载则降级提示，
  // 提供外链新窗口兜底（blocked/失败站点永不保留 iframe 交互假象）。A6-1 由
  // resolveLaunch 门禁保证：external_web 端点永不渲染 iframe（既有测试覆盖）。
  useEffect(() => {
    if (!visibleResult || visibleResult.mode === 'external_web') { setFrameFailed(false); return; }
    const timer = setTimeout(() => setFrameFailed(true), FRAME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [visibleResult]);
  // L2-2（docs/pilot/l2-audit-log-design.md 方案 A 修订版 / ui-ux-spec §5.2 A5-3）：
  // 工具打开/外链打开行为打点——fire-and-forget，审计失败仅 console.warn，不阻断工具使用；
  // iframe 内操作不产生任何记录（平台零感知假设显式声明）。
  const recordAudit = (action: 'tool_open.embedded' | 'tool_open.external', endpointId: string | null) => {
    void service.recordToolAudit({ action, endpointId, toolId }).catch((cause) => {
      console.warn('[engineering-tools] audit record failed', { action, toolId, cause });
    });
  };
  const launch = async () => {
    if (!canLaunch || !endpoint) return;
    const popup = endpoint.mode === 'external_web' ? window.open('about:blank', '_blank') : null;
    if (popup) {
      popup.opener = null;
      const policy = popup.document.createElement('meta');
      policy.name = 'referrer';
      policy.content = 'no-referrer';
      popup.document.head.append(policy);
    }
    const current = ++requestId.current;
    setBusy(true); setFailure(''); setResult(undefined); setFrameFailed(false);
    try {
      const resolved = await service.resolveLaunch({ toolId, ...(selected ? { endpointId: selected } : {}) });
      const scope = currentScope.current;
      const fresh = scope.data?.some((item) => item.id === resolved.endpointId && item.revision === resolved.revision && item.available);
      if (current !== requestId.current || !scope.ready || scope.error || !fresh || resolved.toolId !== toolId || resolved.endpointId !== endpoint.id) {
        popup?.close();
        if (current === requestId.current) { setFailure('入口已更新，请刷新后重新启动。'); void mutate(); }
        return;
      }
      if (resolved.mode === 'external_web') {
        if (!resolved.url) {
          popup?.close();
          setFailure('入口未返回有效地址，请联系端点管理员。');
          return;
        }
        if (popup) popup.location.replace(resolved.url);
        else setFailure('浏览器阻止了新窗口，请允许弹出窗口后重试。');
        // L2-2: external launch audit point (after successful URL handoff).
        recordAudit('tool_open.external', resolved.endpointId);
      } else {
        setResult(resolved);
        // L2-2: embedded launch audit point (before iframe render).
        recordAudit('tool_open.embedded', resolved.endpointId);
      }
    } catch (error) { popup?.close(); if (current === requestId.current) setFailure(workspaceError(error)); }
    finally { if (current === requestId.current) setBusy(false); }
  };
  return <section aria-label={`${toolName} 操作面板`}>
    <h3 style={{ overflowWrap: 'anywhere' }}>{toolName}</h3>
    <AsyncBoundary data={data} error={error} isLoading={isLoading} onRetry={() => void mutate()}>
      <div className={styles.toolbar}>
        <label className={styles.field} style={{ flex: '1 1 220px' }}><span>{toolName} 启动入口</span><Select disabled={!ready} value={selected} options={[
          ...((data ?? []).some((item) => item.id === null) ? [] : [{ label: '选择启动入口', value: '', disabled: true }]),
          ...(data ?? []).map((item) => ({ disabled: !item.available, label: `${item.title} · ${endpointModeLabels[item.mode]}${item.reason ? ` · ${endpointReasonLabels[item.reason]}` : ''}`, value: item.id ?? '' })),
          ...(unavailableDefault ? [{ label: '已保存入口失效', value: selected, disabled: true }] : []),
        ]} onChange={(value) => { close(); setSelected(value ?? ''); onEndpointChange?.(value || null); }} /></label>
        <Button disabled={!canLaunch} icon={<Play size={16} />} loading={busy} onClick={() => void launch()}>启动工具</Button>
        {visibleResult && <Button aria-label="关闭工具" icon={<X size={16} />} title="关闭工具" onClick={close} />}
      </div>
      {endpoint?.authPrerequisite && <p>{endpoint.authPrerequisite}</p>}
      {unavailableDefault && <p role="status">默认入口已失效或无权访问，请重新选择入口。</p>}
      {!data?.length && <p role="status">暂无通过许可与接入核验的入口。未知、未许可或停用端点不可启动。</p>}
      {data?.some((item) => !item.available) && <ul>{data.filter((item) => !item.available).map((item) => <li key={item.id}><strong>{item.title}</strong> · {endpointModeLabels[item.mode]} · {licenseLabels[item.licenseState]} · {item.reason ? endpointReasonLabels[item.reason] : '不可用'}</li>)}</ul>}
    </AsyncBoundary>
    {failure && <p role="alert">{failure}</p>}
    {authorizedResult && authorizedResult.mode !== 'external_web' && <div hidden={!visibleResult}>
      <div className={styles.toolbar}><strong>{endpointModeLabels[authorizedResult.mode]}</strong><span className={styles.muted}>核验时间：{authorizedResult.evidenceCheckedAt}</span></div>
      {/* L2-1：加载超时/错误降级——隐藏 iframe，显示提示卡与外链新窗口按钮（A-07/A-08）。 */}
      {frameFailed ? <div role="status" style={{ border: '1px solid rgba(0,0,0,0.15)', padding: 12 }}>
        <p>{toolName} 页面加载超时或被站点限制，工作区内暂不可用。可改用官方站点新窗口打开。</p>
        <a href={authorizedResult.url} rel="noopener noreferrer" target="_blank">新窗口打开官方页面 <ExternalLink aria-hidden size={14} /></a>
      </div> : <iframe className={styles.frame} referrerPolicy="no-referrer" sandbox="allow-forms allow-scripts allow-downloads" src={authorizedResult.url} title={authorizedResult.title} onError={() => setFrameFailed(true)} onLoad={() => setFrameFailed(false)} />}
      <p className={styles.muted}>页面被厂商限制或登录失败时，请关闭并联系端点管理员。</p>
    </div>}
  </section>;
};

export default LaunchPanel;
