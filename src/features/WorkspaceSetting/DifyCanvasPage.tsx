'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ExternalLink, Play, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import BusinessSettingsPageShell from '@/business/client/BusinessSettingPages/BusinessSettingsPageShell';
import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import NavHeader from '@/features/NavHeader';
import ContextDetailPanel, { ContextDetailToggle } from '@/features/RightPanel/ContextDetailPanel';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  list: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    list-style: none;
    margin: 0;
    padding: 0;
  `,
  row: css`
    align-items: center;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: space-between;
    min-height: 64px;
    padding-block: 12px;
  `,
  input: css`
    background: ${cssVar.colorBgContainer};
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 8px;
    color: ${cssVar.colorText};
    display: block;
    font: inherit;
    margin-block: 8px 16px;
    max-width: 720px;
    padding: 10px;
    resize: vertical;
    width: 100%;
  `,
  field: css`
    display: grid;
    gap: 6px;
    margin-block: 12px;
    max-width: 720px;
  `,
  output: css`
    background: ${cssVar.colorFillQuaternary};
    border-radius: 8px;
    max-height: 480px;
    overflow: auto;
    padding: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  `,
}));

const DifyCanvasPage = () => {
  const workspace = useActiveWorkspace();
  const adminRole = useUserStore((state) => userProfileSelectors.userProfile(state)?.role);
  const canOpenDifyStudio =
    hasAdminCapability(adminRole, ADMIN_CAPABILITIES.systemWrite) ||
    hasAdminCapability(adminRole, ADMIN_CAPABILITIES.moduleAppWrite);
  const [openingId, setOpeningId] = useState<string>();
  const [error, setError] = useState<string>();
  const [outputsText, setOutputsText] = useState<string>();
  const [outputsAppId, setOutputsAppId] = useState<string>();
  const [runningId, setRunningId] = useState<string>();
  const [selectedAppId, setSelectedAppId] = useState<string>();
  const [inputAppId, setInputAppId] = useState<string>();
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const {
    data: published,
    error: listError,
    isLoading,
    mutate,
  } = useSWR(
    workspace ? ['dify-canvas-published', workspace.id] : null,
    () => lambdaClient.difyCanvas.list.query(),
    { revalidateOnFocus: true },
  );
  const publishedWorkflows = published?.available ? published.workflows : [];
  const activeAppId = publishedWorkflows.some(({ appId }) => appId === selectedAppId)
    ? selectedAppId
    : publishedWorkflows[0]?.appId;
  const { data: parameters, error: parametersError, isLoading: parametersLoading } = useSWR(
    workspace && activeAppId ? ['dify-canvas-parameters', workspace.id, activeAppId] : null,
    () => lambdaClient.difyCanvas.parameters.query({ appId: activeAppId! }),
    { revalidateOnFocus: true },
  );
  const currentParameters = parameters?.appId === activeAppId ? parameters : undefined;
  // The server capability procedure is the authority for Studio controls. The
  // workspace's local role and any Dify account ID are deliberately not used.
  const { data: admin, error: adminError } = useSWR(
    workspace && canOpenDifyStudio ? ['dify-canvas-admin', workspace.id] : null,
    () => lambdaClient.difyCanvas.adminList.query(),
    { revalidateOnFocus: true },
  );
  const { data: globalAdmin } = useSWR(
    canOpenDifyStudio ? 'dify-canvas-admin-entry' : null,
    () => lambdaClient.difyCanvas.adminEntry.query(),
    { revalidateOnFocus: true },
  );

  const openStudio = async (appId: string) => {
    const popup = window.open('', '_blank');
    if (!popup) {
      setError('浏览器阻止了新窗口，请允许弹出窗口后重试。');
      return;
    }
    popup.opener = null;
    setOpeningId(appId);
    setError(undefined);
    try {
      const { url } = await lambdaClient.difyCanvas.openStudio.mutate({ appId });
      popup.location.replace(url);
    } catch {
      popup.close();
      setError('画布当前不可打开，请检查管理员权限和 Dify 服务状态后重试。');
      await mutate();
    } finally {
      setOpeningId(undefined);
    }
  };

  const openGlobalStudio = () => {
    if (!globalAdmin?.available || !globalAdmin.url) return;
    const popup = window.open('', '_blank');
    if (!popup) {
      setError('浏览器阻止了新窗口，请允许弹出窗口后重试。');
      return;
    }
    popup.opener = null;
    popup.location.replace(globalAdmin.url);
  };

  const hasPublishedFlows = Boolean(published?.available && published.workflows.length);
  const hasAdminMapping = Boolean(admin?.available);
  const formReady = Boolean(currentParameters && inputAppId === activeAppId);
  const detailWorkflow = publishedWorkflows.find((workflow) => workflow.appId === activeAppId) ??
    admin?.workflows.find((workflow) => workflow.appId === activeAppId) ?? admin?.workflows[0];

  useEffect(() => {
    setOutputsText(undefined);
    setOutputsAppId(undefined);
    setError(undefined);
    setInputAppId(undefined);
    setInputValues({});
  }, [activeAppId]);

  useEffect(() => {
    if (!activeAppId || !currentParameters || inputAppId === activeAppId) return;
    setInputValues(
      Object.fromEntries(
        currentParameters.fields.map((field) => [
          field.variable,
          field.defaultValue === undefined
            ? field.type === 'checkbox'
              ? false
              : ''
            : field.type === 'json_object'
              ? JSON.stringify(field.defaultValue, null, 2)
              : field.defaultValue,
        ]),
      ),
    );
    setInputAppId(activeAppId);
  }, [activeAppId, currentParameters, inputAppId]);

  const runWorkflow = async () => {
    if (!activeAppId || !currentParameters || inputAppId !== activeAppId) return;
    setError(undefined);
    setOutputsText(undefined);
    const inputs = { ...inputValues };
    try {
      for (const field of currentParameters.fields) {
        if (field.type !== 'json_object' || typeof inputs[field.variable] !== 'string') continue;
        const value: unknown = JSON.parse(inputs[field.variable] as string);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON object');
        inputs[field.variable] = value;
      }
    } catch {
      setError('JSON 对象字段必须填写有效的 JSON 对象。');
      return;
    }

    setRunningId(activeAppId);
    try {
      const result = await lambdaClient.difyCanvas.run.mutate({
        appId: activeAppId,
        inputs: inputs as Record<string, unknown>,
      });
      setOutputsText(JSON.stringify(result.outputs, null, 2));
      setOutputsAppId(activeAppId);
      if (!result.auditRecorded) {
        setError('流程已执行，但审计结果未确认；请核对运行记录后再重试。');
      }
    } catch {
      setError('未收到流程确认，流程可能已执行；请先核对运行记录后再重试。');
    } finally {
      setRunningId(undefined);
    }
  };

  return (
    <Flexbox horizontal height="100%" style={{ minWidth: 0, overflow: 'hidden' }} width="100%">
    <Flexbox flex={1} style={{ minWidth: 0, overflow: 'auto' }}>
    <NavHeader right={<ContextDetailToggle title="流程详情" />} />
    <BusinessSettingsPageShell title="AI 流程画布">
      {!workspace && (
        <>
          <Alert showIcon message="已发布流程需在授权工作区内使用。" type="info" />
          {globalAdmin?.available && globalAdmin.url && (
            <>
              <p>
                Dify Studio 需要已预邀的编辑员身份；Casdoor 登录可复用，但 Fab 管理员角色不会自动授予 Dify 编辑权限。
              </p>
              <Button onClick={openGlobalStudio}>
                <ExternalLink aria-hidden size={16} /> 打开 Dify Studio
              </Button>
            </>
          )}
        </>
      )}
      {workspace && canOpenDifyStudio && !hasAdminMapping && globalAdmin?.available && globalAdmin.url && (
        <div>
          <p>
            Dify Studio 需要已预邀的编辑员身份；Casdoor 登录可复用，但 Fab 管理员角色不会自动授予 Dify 编辑权限。
          </p>
          <Button onClick={openGlobalStudio}>
            <ExternalLink aria-hidden size={16} /> 打开 Dify Studio
          </Button>
        </div>
      )}
      {workspace && isLoading && <p>正在读取流程…</p>}
      {workspace && listError && <Alert showIcon message="已发布流程列表暂不可用。" type="error" />}
      {workspace && published && !published.available && !hasAdminMapping && !adminError && (
        <Alert showIcon message="Dify Studio 尚未就绪，流程入口暂不可用。" type="info" />
      )}
      {adminError && !hasPublishedFlows && (
        <Alert
          showIcon
          message="当前工作区没有可用的已发布流程。Studio 画布仅对获授权管理员开放。"
          type="info"
        />
      )}
      {error && <Alert showIcon message={error} type="error" />}

      {hasPublishedFlows && (
        <>
          <h2>可用流程</h2>
          <ul className={styles.list}>
            {published!.workflows.map((workflow) => (
              <li className={styles.row} key={workflow.appId}>
                <strong>{workflow.name}</strong>
                <Button disabled={Boolean(runningId)} onClick={() => setSelectedAppId(workflow.appId)}>
                  {activeAppId === workflow.appId ? '当前流程' : '选择流程'}
                </Button>
              </li>
            ))}
          </ul>
          {parametersLoading && !currentParameters && <p>正在读取流程表单…</p>}
          {parametersError && <Alert showIcon message="该流程表单暂不可用，未发送执行请求。" type="error" />}
          {currentParameters && formReady && activeAppId && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runWorkflow();
              }}
            >
              {currentParameters.fields.length === 0 && <p>该流程无需输入，可直接运行。</p>}
              {currentParameters.fields.map((field) => (
                <label className={styles.field} key={field.variable}>
                  <span>
                    {field.label}
                    {field.required ? ' *' : ''}
                  </span>
                  {field.type === 'select' ? (
                    <select
                      className={styles.input}
                      required={field.required}
                      value={String(inputValues[field.variable] ?? '')}
                      onChange={(event) =>
                        setInputValues((current) => ({ ...current, [field.variable]: event.target.value }))
                      }
                    >
                      <option value="">请选择</option>
                      {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : field.type === 'checkbox' ? (
                    <input
                      checked={Boolean(inputValues[field.variable])}
                      type="checkbox"
                      onChange={(event) =>
                        setInputValues((current) => ({ ...current, [field.variable]: event.target.checked }))
                      }
                    />
                  ) : field.type === 'paragraph' || field.type === 'json_object' ? (
                    <textarea
                      className={styles.input}
                      required={field.required}
                      rows={field.type === 'paragraph' ? 4 : 6}
                      value={String(inputValues[field.variable] ?? '')}
                      onChange={(event) =>
                        setInputValues((current) => ({ ...current, [field.variable]: event.target.value }))
                      }
                    />
                  ) : (
                    <input
                      className={styles.input}
                      maxLength={field.maxLength}
                      required={field.required}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={String(inputValues[field.variable] ?? '')}
                      onChange={(event) =>
                        setInputValues((current) => ({
                          ...current,
                          [field.variable]:
                            field.type === 'number' && event.target.value !== ''
                              ? Number(event.target.value)
                              : event.target.value,
                        }))
                      }
                    />
                  )}
                </label>
              ))}
              <Button
                disabled={Boolean(runningId) || !formReady}
                htmlType="submit"
                loading={runningId === activeAppId}
              >
                <Play aria-hidden size={16} /> 运行流程
              </Button>
            </form>
          )}
          {outputsText && outputsAppId === activeAppId && (
            <pre aria-label="流程输出" className={styles.output}>
              {outputsText}
            </pre>
          )}
        </>
      )}

      {workspace && hasAdminMapping && (
        <>
          <h2>Dify Studio 画布</h2>
          <p>
            Studio 编辑权限仍由 Dify 自身账号与工作区权限控制；Fab 管理员角色不会自动赋予编辑授权。
          </p>
          <Button icon={<RefreshCw size={16} />} title="刷新流程" onClick={() => void mutate()} />
          {admin!.workflows.length === 0 ? (
            <p>当前工作区尚未配置流程映射。</p>
          ) : (
            <ul className={styles.list}>
              {admin!.workflows.map((workflow) => (
                <li className={styles.row} key={workflow.appId}>
                  <strong>{workflow.name}</strong>
                  <Button
                    disabled={Boolean(openingId)}
                    loading={openingId === workflow.appId}
                    onClick={() => void openStudio(workflow.appId)}
                  >
                    <ExternalLink aria-hidden size={16} /> 打开 Dify Studio 画布
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </BusinessSettingsPageShell>
    </Flexbox>
    <ContextDetailPanel title="流程详情">
      {detailWorkflow ? <>
      <h2>{detailWorkflow.name}</h2>
      <p>当前工作区：{workspace?.name}</p>
      <p>{publishedWorkflows.some((workflow) => workflow.appId === detailWorkflow.appId)
        ? '已发布流程可在 Fab 内按工作区权限运行。'
        : '当前流程仅供获授权管理员在 Dify Studio 中编辑。'}</p>
      {currentParameters?.appId === detailWorkflow.appId && <>
        <h3>输入字段</h3>
        {currentParameters.fields.length === 0 ? <p>无需输入字段。</p> : <ul>
          {currentParameters.fields.map((field) => <li key={field.variable}>{field.label}{field.required ? '（必填）' : ''}</li>)}
        </ul>}
      </>}
      <p>Studio 编辑仍需该 Dify 工作区授权；此面板仅展示当前流程信息，不会运行模型。</p>
      </> : <>
        <h2>{workspace ? workspace.name : '个人范围'}</h2>
        <p>{workspace
          ? '当前工作区没有可选流程。已发布流程需先获得工作区使用授权；编辑画布还需 Dify 编辑权限。'
          : '个人范围没有工作区流程。切换到获授权工作区后，可选择已发布流程查看输入信息。'}</p>
      </>}
    </ContextDetailPanel>
    </Flexbox>
  );
};

export default DifyCanvasPage;
