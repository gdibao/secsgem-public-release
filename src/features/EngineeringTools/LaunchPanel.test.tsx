import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolEndpointSummary } from '@/business/server/engineering-tools/workspaceSchema';

import LaunchPanel from './LaunchPanel';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(), mutate: vi.fn(), recordAudit: vi.fn(async () => ({ ok: true })), endpoints: [] as ToolEndpointSummary[], ready: true,
  popup: {
    opener: null as Window | null,
    close: vi.fn(),
    document: { createElement: vi.fn(() => ({ name: '', content: '' })), head: { append: vi.fn() } },
    location: { replace: vi.fn() },
  },
}));
vi.mock('./useEngineeringWorkspace', () => ({
  useEngineeringWorkspaceScope: () => ({ ready: mocks.ready }),
  useFetchToolEndpoints: () => ({ data: mocks.endpoints, mutate: mocks.mutate, isLoading: false }),
}));
vi.mock('@/services/engineeringWorkspace', () => ({ engineeringWorkspaceService: { resolveLaunch: mocks.resolve, recordToolAudit: mocks.recordAudit } }));

describe('LaunchPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.endpoints = []; mocks.ready = true;
    vi.spyOn(window, 'open').mockReturnValue(mocks.popup as unknown as Window);
    const browser = window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean; handleDisabledFileLoadingAsSuccess: boolean } } };
    browser.happyDOM.settings.disableIframePageLoading = true;
    browser.happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
  });
  afterEach(() => vi.restoreAllMocks());

  it('blocks endpoint launch until a workspace route resolves to an ID', () => {
    mocks.ready = false;
    mocks.endpoints = [{ id: 'endpoint', revision: 'configured:endpoint:1', available: true, licenseState: 'verified', reason: null, mode: 'external_web', title: 'Approved', authPrerequisite: '' }];
    render(<LaunchPanel defaultEndpointId="endpoint" toolId="EXAMPLE" toolName="Example" />);
    expect(screen.getByRole('button', { name: '启动工具' })).toBeDisabled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('disables unknown entry points and never constructs a URL', () => {
    render(<LaunchPanel toolId="EXAMPLE" toolName="Example" />);
    expect(screen.getByRole('button', { name: '启动工具' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('暂无通过许可');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not silently replace an unavailable saved default with a legacy launch', () => {
    mocks.endpoints = [{ id: null, revision: 'legacy:v1', available: true, licenseState: 'verified', reason: null, mode: 'external_web', title: 'Legacy', authPrerequisite: '' }];
    render(<LaunchPanel defaultEndpointId="missing" toolId="EXAMPLE" toolName="Example" />);
    expect(screen.getByRole('button', { name: '启动工具' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('默认入口已失效');
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it.each(['external_web', 'embedded_web', 'hosted_web'] as const)('uses only the authorized %s result', async (mode) => {
    mocks.endpoints = [{ id: 'endpoint', revision: 'configured:endpoint:1', mode, available: true, licenseState: 'verified', reason: null, title: 'Approved', authPrerequisite: 'Vendor login' }];
    mocks.resolve.mockResolvedValue({ mode, revision: 'configured:endpoint:1', url: 'https://example.com/work', title: 'Approved', toolId: 'EXAMPLE', endpointId: 'endpoint', evidenceCheckedAt: '2026-10-18T01:00:00Z', framePolicy: 'verified' });
    const { container } = render(<LaunchPanel defaultEndpointId="endpoint" toolId="EXAMPLE" toolName="Example" />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '启动工具' }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith({ toolId: 'EXAMPLE', endpointId: 'endpoint' }));
    if (mode === 'external_web') {
      await waitFor(() => expect(mocks.popup.location.replace).toHaveBeenCalledWith('https://example.com/work'));
      expect(mocks.popup.opener).toBeNull();
      expect(mocks.popup.document.head.append).toHaveBeenCalledWith(expect.objectContaining({ name: 'referrer', content: 'no-referrer' }));
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    } else {
      expect(await screen.findByTitle('Approved')).toHaveAttribute('src', 'https://example.com/work');
      expect(screen.getByTitle('Approved')).toHaveAttribute('sandbox');
    }
  });

  it('withdraws an embedded result when the same endpoint ID gets a new revision', async () => {
    mocks.endpoints = [{ id: 'endpoint', revision: 'configured:endpoint:1', mode: 'embedded_web', available: true, licenseState: 'verified', reason: null, title: 'Approved', authPrerequisite: '' }];
    mocks.resolve.mockResolvedValue({ mode: 'embedded_web', revision: 'configured:endpoint:1', url: 'https://example.com/old', title: 'Approved', toolId: 'EXAMPLE', endpointId: 'endpoint', evidenceCheckedAt: '2026-10-18T01:00:00Z', framePolicy: 'verified' });
    const { container, rerender } = render(<LaunchPanel defaultEndpointId="endpoint" toolId="EXAMPLE" toolName="Example" />);
    fireEvent.click(screen.getByRole('button', { name: '启动工具' }));
    expect(await screen.findByTitle('Approved')).toHaveAttribute('src', 'https://example.com/old');
    mocks.endpoints = [{ ...mocks.endpoints[0], revision: 'configured:endpoint:2' }];
    rerender(<LaunchPanel defaultEndpointId="endpoint" toolId="EXAMPLE" toolName="Example" />);
    await waitFor(() => expect(container.querySelector('iframe')).toBeNull());
    expect(screen.queryByRole('button', { name: '关闭工具' })).not.toBeInTheDocument();
  });

  it('keeps a hidden runtime mounted but rechecks authorization before showing it again', async () => {
    mocks.endpoints = [{ id: 'endpoint', revision: 'configured:endpoint:1', mode: 'embedded_web', available: true,
      licenseState: 'verified', reason: null, title: 'Approved', authPrerequisite: '' }];
    mocks.resolve.mockResolvedValue({ mode: 'embedded_web', revision: 'configured:endpoint:1',
      url: 'https://example.com/work', title: 'Approved', toolId: 'EXAMPLE', endpointId: 'endpoint',
      evidenceCheckedAt: '2026-10-18T01:00:00Z', framePolicy: 'verified' });
    const { container, rerender } = render(<LaunchPanel active defaultEndpointId="endpoint" toolId="EXAMPLE" toolName="Example" />);
    fireEvent.click(screen.getByRole('button', { name: '启动工具' }));
    const frame = await screen.findByTitle('Approved');
    rerender(<LaunchPanel active={false} defaultEndpointId="endpoint" toolId="EXAMPLE" toolName="Example" />);
    expect(container.querySelector('iframe')).toBe(frame);
    expect(frame.parentElement).toHaveAttribute('hidden');
    let finish!: (value: typeof mocks.endpoints) => void;
    mocks.mutate.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    rerender(<LaunchPanel active defaultEndpointId="endpoint" toolId="EXAMPLE" toolName="Example" />);
    expect(frame.parentElement).toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: '启动工具' })).toBeDisabled();
    mocks.endpoints = [{ ...mocks.endpoints[0], revision: 'configured:endpoint:2' }];
    finish(mocks.endpoints);
    rerender(<LaunchPanel active defaultEndpointId="endpoint" toolId="EXAMPLE" toolName="Example" />);
    await waitFor(() => expect(container.querySelector('iframe')).toBeNull());
  });

  it.each([
    { id: 'endpoint', oldRevision: 'configured:endpoint:1', newRevision: 'configured:endpoint:2' },
    { id: null, oldRevision: 'legacy:old', newRevision: 'legacy:new' },
  ])('re-resolves an external launch for $id and refuses a mismatched revision', async ({ id, oldRevision, newRevision }) => {
    mocks.endpoints = [{ id, revision: oldRevision, mode: 'external_web', available: true, licenseState: 'verified', reason: null, title: 'Approved', authPrerequisite: '' }];
    const { rerender } = render(<LaunchPanel defaultEndpointId={id} toolId="EXAMPLE" toolName="Example" />);
    const input = id ? { toolId: 'EXAMPLE', endpointId: id } : { toolId: 'EXAMPLE' };
    mocks.resolve.mockResolvedValue({ mode: 'external_web', revision: newRevision, url: 'https://example.com/new', title: 'Approved', toolId: 'EXAMPLE', endpointId: id, target: '_blank', rel: 'noopener noreferrer', authPrerequisite: '' });
    fireEvent.click(screen.getByRole('button', { name: '启动工具' }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith(input));
    await waitFor(() => expect(mocks.popup.close).toHaveBeenCalled());
    expect(mocks.popup.location.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('入口已更新');
    mocks.endpoints = [{ ...mocks.endpoints[0], revision: newRevision }];
    rerender(<LaunchPanel defaultEndpointId={id} toolId="EXAMPLE" toolName="Example" />);
    fireEvent.click(screen.getByRole('button', { name: '启动工具' }));
    await waitFor(() => expect(mocks.popup.location.replace).toHaveBeenCalledWith('https://example.com/new'));
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
  });

  it('rejects a resolved external entry without a URL', async () => {
    mocks.endpoints = [{ id: null, revision: 'legacy:current', mode: 'external_web', available: true, licenseState: 'verified', reason: null, title: 'Legacy', authPrerequisite: '' }];
    mocks.resolve.mockResolvedValue({ mode: 'external_web', revision: 'legacy:current', url: null, title: 'Legacy', toolId: 'EXAMPLE', endpointId: null, target: '_blank', rel: 'noopener noreferrer', authPrerequisite: '' });
    render(<LaunchPanel toolId="EXAMPLE" toolName="Example" />);
    fireEvent.click(screen.getByRole('button', { name: '启动工具' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('入口未返回有效地址');
    expect(mocks.popup.close).toHaveBeenCalled();
    expect(mocks.popup.location.replace).not.toHaveBeenCalled();
  });

  it('shows server denial and leaves no executable link or frame', async () => {
    mocks.resolve.mockRejectedValue({ data: { code: 'FORBIDDEN' } });
    mocks.endpoints = [{ id: null, revision: 'legacy:v1', available: true, licenseState: 'verified', reason: null, mode: 'external_web', title: 'Legacy', authPrerequisite: '' }];
    const { container } = render(<LaunchPanel toolId="EXAMPLE" toolName="Example" />);
    fireEvent.click(screen.getByRole('button', { name: '启动工具' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无权执行');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
  });
  it('shows each unavailable mode and its server reason without enabling launch', () => {
    mocks.endpoints = [
      { id: 'pending', revision: 'configured:pending:1', mode: 'external_web', available: false, licenseState: 'pending', reason: 'license_pending', title: 'Pending official', authPrerequisite: '' },
      { id: 'embed', revision: 'configured:embed:1', mode: 'embedded_web', available: false, licenseState: 'verified', reason: 'embed_unverified', title: 'Unverified embed', authPrerequisite: '' },
      { id: 'hosted', revision: 'configured:hosted:1', mode: 'hosted_web', available: false, licenseState: 'verified', reason: 'hosted_unverified', title: 'Unverified hosted', authPrerequisite: '' },
    ];
    render(<LaunchPanel defaultEndpointId="embed" toolId="EXAMPLE" toolName="Example" />);
    expect(screen.getByRole('button', { name: '启动工具' })).toBeDisabled();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('嵌入许可、响应头或浏览器登录未核准');
    expect(screen.getAllByRole('listitem')[2]).toHaveTextContent('托管权利、部署身份或健康未核准');
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  // L2-2 (docs/pilot/l2-audit-log-design.md): embedded/external launch records
  // a tool-open audit point; audit failure must not break the launch flow.
  it('records an audit point for embedded and external launches', async () => {
    mocks.endpoints = [{ id: 'endpoint', revision: 'configured:endpoint:1', mode: 'embedded_web', available: true, licenseState: 'verified', reason: null, title: 'Approved', authPrerequisite: '' }];
    mocks.resolve.mockResolvedValue({ mode: 'embedded_web', revision: 'configured:endpoint:1', url: 'https://example.com/work', title: 'Approved', toolId: 'EXAMPLE', endpointId: 'endpoint', evidenceCheckedAt: '2026-10-18T01:00:00Z', framePolicy: 'verified' });
    render(<LaunchPanel defaultEndpointId="endpoint" toolId="EXAMPLE" toolName="Example" />);
    fireEvent.click(screen.getByRole('button', { name: '启动工具' }));
    await waitFor(() => expect(mocks.recordAudit).toHaveBeenCalledWith({ action: 'tool_open.embedded', endpointId: 'endpoint', toolId: 'EXAMPLE' }));
    expect(await screen.findByTitle('Approved')).toBeInTheDocument();
  });

  it('still launches externally when the audit point fails', async () => {
    mocks.recordAudit.mockRejectedValueOnce(new Error('audit down'));
    mocks.endpoints = [{ id: 'endpoint', revision: 'configured:endpoint:1', mode: 'external_web', available: true, licenseState: 'verified', reason: null, title: 'Approved', authPrerequisite: '' }];
    mocks.resolve.mockResolvedValue({ mode: 'external_web', revision: 'configured:endpoint:1', url: 'https://example.com/work', title: 'Approved', toolId: 'EXAMPLE', endpointId: 'endpoint', target: '_blank', rel: 'noopener noreferrer', authPrerequisite: '' });
    const { container } = render(<LaunchPanel defaultEndpointId="endpoint" toolId="EXAMPLE" toolName="Example" />);
    fireEvent.click(screen.getByRole('button', { name: '启动工具' }));
    await waitFor(() => expect(mocks.popup.location.replace).toHaveBeenCalledWith('https://example.com/work'));
    await waitFor(() => expect(mocks.recordAudit).toHaveBeenCalledWith({ action: 'tool_open.external', endpointId: 'endpoint', toolId: 'EXAMPLE' }));
    expect(container.querySelector('iframe')).toBeNull();
  });
});
