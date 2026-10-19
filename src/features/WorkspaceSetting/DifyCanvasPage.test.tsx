import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';

import DifyCanvasPage from './DifyCanvasPage';

const mocks = vi.hoisted(() => ({
  adminAvailable: false,
  globalAdminAvailable: false,
  globalAdminUrl: 'https://studio.secsgem.com.cn/',
  adminRole: 'member',
  adminWorkflows: [] as Array<{ appId: string; name: string }>,
  available: false,
  list: vi.fn(),
  mutate: vi.fn(),
  openStudio: vi.fn(),
  parameters: { appId: 'app-a', fields: [] as Array<{
    defaultValue?: boolean | number | string | Record<string, unknown>;
    label: string;
    maxLength?: number;
    options?: string[];
    required: boolean;
    type: 'text-input' | 'paragraph' | 'number' | 'select' | 'checkbox' | 'json_object';
    variable: string;
  }> },
  parametersByApp: {} as Record<string, {
    appId: string;
    fields: Array<{
      defaultValue?: boolean | number | Record<string, unknown> | string;
      label: string;
      maxLength?: number;
      options?: string[];
      required: boolean;
      type: 'text-input' | 'paragraph' | 'number' | 'select' | 'checkbox' | 'json_object';
      variable: string;
    }>;
  }>,
  parametersError: undefined as Error | undefined,
  run: vi.fn(),
  publishedWorkflows: [] as Array<{ appId: string; name: string }>,
  workspace: { id: 'ws-a', name: 'A区', role: 'member' } as null | {
    id: string;
    name: string;
    role: string;
  },
}));

vi.mock('@/business/client/hooks/useActiveWorkspace', () => ({
  useActiveWorkspace: () => mocks.workspace,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    difyCanvas: {
      adminEntry: { query: mocks.list },
      adminList: { query: mocks.list },
      list: { query: mocks.list },
      openStudio: { mutate: mocks.openStudio },
      parameters: { query: mocks.list },
      run: { mutate: mocks.run },
    },
  },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { role: string | null }) => unknown) =>
    selector({ role: mocks.adminRole }),
}));
vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: { getHotkeyById: () => () => undefined },
  userProfileSelectors: { userProfile: (state: { role: string | null }) => ({ role: state.role }) },
}));
vi.mock('swr', () => ({
  default: (key: unknown) => ({
    data: key
      ? key === 'dify-canvas-admin-entry'
        ? { available: mocks.globalAdminAvailable, url: mocks.globalAdminUrl }
        : String((key as unknown[])[0]).includes('parameters')
        ? mocks.parametersError
          ? undefined
          : mocks.parametersByApp[String((key as unknown[])[2])] ?? mocks.parameters
        : String((key as unknown[])[0]).includes('admin')
        ? {
            available: mocks.adminAvailable,
            workflows: mocks.adminAvailable ? mocks.adminWorkflows : [],
          }
        : { available: mocks.available, workflows: mocks.available ? mocks.publishedWorkflows : [] }
      : undefined,
    error: key && String((key as unknown[])[0]).includes('parameters') ? mocks.parametersError : undefined,
    isLoading: false,
    mutate: mocks.mutate,
  }),
}));
vi.mock('@/business/client/BusinessSettingPages/BusinessSettingsPageShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.available = false;
  mocks.adminAvailable = false;
  mocks.globalAdminAvailable = false;
  mocks.adminRole = 'member';
  mocks.adminWorkflows = [];
  mocks.publishedWorkflows = [];
  mocks.parameters = { appId: 'app-a', fields: [] };
  mocks.parametersByApp = {};
  mocks.parametersError = undefined;
  mocks.run.mockResolvedValue({ auditRecorded: true, outputs: { answer: 'OK' }, status: 'succeeded' });
  mocks.workspace = { id: 'ws-a', name: 'A区', role: 'member' };
});

describe('DifyCanvasPage', () => {
  it('restores panels in personal scope without inventing a workflow', () => {
    mocks.workspace = null;
    const state = useGlobalStore.getState();
    useGlobalStore.setState({ isStatusInit: true, status: { ...state.status, showLeftPanel: false, showRightPanel: false } });
    render(<DifyCanvasPage />);
    const left = screen.getByRole('button', { name: /显示\/隐藏左侧面板|Toggle Left Panel|toggleLeftPanel/i });
    const right = screen.getByRole('button', { name: '显示流程详情' });
    fireEvent.click(right);
    expect(screen.getByText(/个人范围没有工作区流程/)).toBeInTheDocument();
    fireEvent.click(left);
    expect(useGlobalStore.getState().status.showLeftPanel).toBe(true);
    expect(useGlobalStore.getState().status.showRightPanel).toBe(true);
  });

  it('shows selected workspace workflow details and keeps Studio permissions separate', () => {
    mocks.available = true;
    mocks.publishedWorkflows = [{ appId: 'app-a', name: 'A 流程' }];
    const state = useGlobalStore.getState();
    useGlobalStore.setState({ isStatusInit: true, status: { ...state.status, showLeftPanel: false, showRightPanel: false } });
    render(<DifyCanvasPage />);
    fireEvent.click(screen.getByRole('button', { name: '显示流程详情' }));
    expect(screen.getByText('当前工作区：A区')).toBeInTheDocument();
    expect(screen.getByText(/不 会自动赋予编辑授权|编辑仍需该 Dify 工作区授权/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /打开 Dify Studio 画布/ })).not.toBeInTheDocument();
  });

  it('keeps the workbench entry internal and gates the external Studio button by server authorization in personal scope', () => {
    mocks.workspace = null;
    mocks.adminRole = 'system_admin';
    mocks.globalAdminAvailable = true;
    render(<DifyCanvasPage />);

    expect(screen.getByText('已发布流程需在授权工作区内使用。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开 Dify Studio/ })).toBeInTheDocument();
  });

  it('does not show an external Studio link in personal scope when the server denies it', () => {
    mocks.workspace = null;
    render(<DifyCanvasPage />);

    expect(screen.queryByRole('button', { name: /打开 Dify Studio/ })).not.toBeInTheDocument();
  });

  it('shows the separately authenticated Studio entry to a platform admin in an unmapped workspace', () => {
    mocks.adminRole = 'module_admin';
    mocks.globalAdminAvailable = true;
    render(<DifyCanvasPage />);

    expect(screen.getByRole('button', { name: /打开 Dify Studio/ })).toBeInTheDocument();
    expect(screen.getByText(/Fab 管理员角色不会自动授予 Dify 编辑权限/)).toBeInTheDocument();
  });

  it('keeps the page unavailable until the Dify instance is healthy', () => {
    render(<DifyCanvasPage />);
    expect(screen.getByText(/尚未就绪/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /打开 Dify Studio 画布/ })).not.toBeInTheDocument();
  });

  it('runs published workflows through Fab without exposing a Dify URL', async () => {
    mocks.available = true;
    mocks.publishedWorkflows = [{ appId: 'app-a', name: 'A 流程' }];
    mocks.parameters = { appId: 'app-a', fields: [] };
    render(<DifyCanvasPage />);
    expect(screen.getAllByText('A 流程').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /打开 Dify Studio 画布/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /运行流程/ }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledWith({ appId: 'app-a', inputs: {} }));
    expect(await screen.findByLabelText('流程输出')).toHaveTextContent('"answer": "OK"');
  });

  it('renders Dify parameters as standard fields and submits their values through Fab', async () => {
    mocks.available = true;
    mocks.publishedWorkflows = [{ appId: 'app-a', name: 'A 流程' }];
    mocks.parameters = {
      appId: 'app-a',
      fields: [
        { label: '项目名称', required: true, type: 'text-input', variable: 'project_name' },
        { label: '优先级', options: ['普通', '紧急'], required: true, type: 'select', variable: 'priority' },
        {
          defaultValue: { plant: 'A' },
          label: '扩展参数',
          required: false,
          type: 'json_object',
          variable: 'extra',
        },
      ],
    };
    render(<DifyCanvasPage />);
    fireEvent.change(screen.getByLabelText('项目名称 *'), { target: { value: '设备验收' } });
    fireEvent.change(screen.getByLabelText('优先级 *'), { target: { value: '紧急' } });
    fireEvent.click(screen.getByRole('button', { name: /运行流程/ }));
    await waitFor(() =>
      expect(mocks.run).toHaveBeenCalledWith({
        appId: 'app-a',
        inputs: { extra: { plant: 'A' }, priority: '紧急', project_name: '设备验收' },
      }),
    );
    expect(screen.queryByLabelText('流程输入（JSON）')).not.toBeInTheDocument();
  });

  it('does not expose a raw JSON fallback or run button when parameters cannot be loaded', () => {
    mocks.available = true;
    mocks.publishedWorkflows = [{ appId: 'app-a', name: 'A 流程' }];
    mocks.parametersError = new Error('unavailable');
    render(<DifyCanvasPage />);
    expect(screen.getByText('该流程表单暂不可用，未发送执行请求。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /运行流程/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('流程输入（JSON）')).not.toBeInTheDocument();
  });

  it('hides the previous app form and never submits its parameters after switching workflows', async () => {
    mocks.available = true;
    mocks.publishedWorkflows = [
      { appId: 'app-a', name: 'A 流程' },
      { appId: 'app-b', name: 'B 流程' },
    ];
    mocks.parametersByApp = {
      'app-a': {
        appId: 'app-a',
        fields: [{ label: 'A 输入', required: false, type: 'text-input', variable: 'a_value' }],
      },
      'app-b': {
        appId: 'app-b',
        fields: [{ label: 'B 输入', required: false, type: 'text-input', variable: 'b_value' }],
      },
    };
    render(<DifyCanvasPage />);
    fireEvent.change(await screen.findByLabelText('A 输入'), { target: { value: '旧流程内容' } });
    fireEvent.click(screen.getByRole('button', { name: '选择流程' }));
    expect(await screen.findByLabelText('B 输入')).toBeInTheDocument();
    expect(screen.queryByLabelText('A 输入')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /运行流程/ }));
    await waitFor(() =>
      expect(mocks.run).toHaveBeenCalledWith({ appId: 'app-b', inputs: { b_value: '' } }),
    );
    expect(JSON.stringify(mocks.run.mock.calls)).not.toContain('旧流程内容');
  });

  it('shows outputs and warns not to retry when the completion audit could not be confirmed', async () => {
    mocks.available = true;
    mocks.publishedWorkflows = [{ appId: 'app-a', name: 'A 流程' }];
    mocks.run.mockResolvedValueOnce({
      auditRecorded: false,
      outputs: { answer: 'done' },
      status: 'succeeded',
    });
    render(<DifyCanvasPage />);
    fireEvent.click(screen.getByRole('button', { name: /运行流程/ }));
    expect(await screen.findByText(/流程已执行，但审计结果未确认/)).toBeInTheDocument();
    expect(await screen.findByLabelText('流程输出')).toHaveTextContent('done');
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it('shows Studio controls only when the server capability query allows them', async () => {
    mocks.adminRole = 'system_admin';
    mocks.adminAvailable = true;
    mocks.adminWorkflows = [{ appId: 'app-a', name: 'A 草稿' }];
    mocks.openStudio.mockResolvedValue({ url: 'https://studio.example.test/app/app-a/workflow' });
    const replace = vi.fn();
    const popup = { close: vi.fn(), location: { replace }, opener: {} };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    try {
      render(<DifyCanvasPage />);
      const button = screen.getByRole('button', { name: /打开 Dify Studio 画布/ });
      fireEvent.click(button);
      await waitFor(() => expect(mocks.openStudio).toHaveBeenCalledWith({ appId: 'app-a' }));
      expect(replace).toHaveBeenCalledWith('https://studio.example.test/app/app-a/workflow');
      expect(popup.opener).toBeNull();
    } finally {
      open.mockRestore();
    }
  });
});
