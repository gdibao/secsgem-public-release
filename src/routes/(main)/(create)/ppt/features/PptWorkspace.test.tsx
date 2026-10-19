import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PptWorkspace from './PptWorkspace';

const serviceMocks = vi.hoisted(() => ({
  createPptToken: vi.fn(),
  getPptRuntime: vi.fn(),
  reportPptEvent: vi.fn(),
}));
const routerLocation = vi.hoisted(() => ({ search: '' }));
const responsiveState = vi.hoisted(() => ({
  constructorEvent: undefined as { type: string } | undefined,
  isMobile: false,
}));

vi.mock('@/services/docmee', () => ({
  docmeeService: serviceMocks,
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => responsiveState.isMobile,
}));

vi.mock('react-router', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useLocation: () => routerLocation,
  useNavigate: () => vi.fn(),
}));

const docmeeConstructor = vi.fn();

vi.mock('@/libs/ppt/docmeeIframe', () => ({
  DocmeeIframeAdapter: function MockDocmeeIframeAdapter(options: any) {
    docmeeConstructor(options);
    if (responsiveState.constructorEvent) {
      void options.onMessage?.(responsiveState.constructorEvent);
    }

    return {
      destroy: vi.fn(),
    };
  },
}));

const emitDocmeeEvent = async (message: Record<string, unknown>) => {
  const options = docmeeConstructor.mock.calls.at(-1)?.[0];
  if (!options?.onMessage) throw new Error('Docmee onMessage callback was not registered');

  await act(async () => {
    await options.onMessage(message);
  });
};

describe('PptWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responsiveState.constructorEvent = undefined;
    responsiveState.isMobile = false;
    routerLocation.search = '';
    serviceMocks.createPptToken.mockResolvedValue({ sessionId: 's1', token: 'token-1' });
    serviceMocks.getPptRuntime.mockResolvedValue({
      allowPdfExport: true,
      allowPptxDownload: true,
      baseUrl: 'https://docmee.cn',
      creatorVersion: 'v2',
      enabled: true,
      lang: 'zh',
    });
    serviceMocks.reportPptEvent.mockResolvedValue({ charged: true });
  });

  it('opens a saved upstream presentation directly in the editor', async () => {
    responsiveState.isMobile = true;
    routerLocation.search = '?recordId=00000000-0000-4000-8000-000000000001';
    serviceMocks.createPptToken.mockResolvedValue({
      sessionId: 'saved-session',
      token: 'token-1',
      upstreamTaskId: 'upstream/ppt-1',
    });

    render(<PptWorkspace />);

    await waitFor(() => expect(docmeeConstructor).toHaveBeenCalled());
    expect(docmeeConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        isMobile: true,
        page: 'editor',
        pptId: 'upstream/ppt-1',
        token: 'token-1',
      }),
    );
    expect(serviceMocks.createPptToken).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
    );
  });

  it('mounts DocmeeUI after runtime and token are ready', async () => {
    render(<PptWorkspace />);

    await waitFor(() => expect(docmeeConstructor).toHaveBeenCalled());
    expect(docmeeConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://docmee.cn',
        isMobile: false,
        page: 'creator-v2',
        token: 'token-1',
      }),
    );
    expect(screen.getByTestId('ppt-workspace-container')).toHaveStyle({
      height: '100%',
      minHeight: '0',
      overflow: 'hidden',
      width: '100%',
    });
  });

  it('does not arm the mount timeout when Docmee reports mounted during construction', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    responsiveState.constructorEvent = { type: 'mounted' };

    render(<PptWorkspace />);

    await waitFor(() => expect(docmeeConstructor).toHaveBeenCalled());
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 15_000);
  });

  it('enables Docmee mobile mode for a new presentation', async () => {
    responsiveState.isMobile = true;

    render(<PptWorkspace />);

    await waitFor(() => expect(docmeeConstructor).toHaveBeenCalled());
    expect(docmeeConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        isMobile: true,
        page: 'creator-v2',
        token: 'token-1',
      }),
    );
  });

  it('uses the shared loading indicator while the runtime is loading', () => {
    serviceMocks.getPptRuntime.mockReturnValue(new Promise(() => undefined));

    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <PptWorkspace />
      </SWRConfig>,
    );

    expect(screen.getByTestId('ppt-workspace-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('ppt-workspace-loading')).toHaveStyle({
      height: '100%',
      minHeight: '0',
      overflow: 'hidden',
      width: '100%',
    });
  });

  it('can recover after token creation fails and the user retries', async () => {
    serviceMocks.createPptToken
      .mockRejectedValueOnce(new Error('PPT_UPSTREAM_TOKEN_FAILED'))
      .mockResolvedValueOnce({ sessionId: 's1', token: 'token-1' });

    render(<PptWorkspace />);

    await screen.findByText('服务连接失败');
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));

    await waitFor(() => expect(docmeeConstructor).toHaveBeenCalled());
  });

  it('shows a retryable error state when the runtime configuration fails to load', async () => {
    serviceMocks.getPptRuntime.mockRejectedValueOnce(new Error('PPT_UPSTREAM_TOKEN_FAILED'));

    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <PptWorkspace />
      </SWRConfig>,
    );

    expect(await screen.findByTestId('ppt-workspace-error')).toHaveStyle({
      height: '100%',
      minHeight: '0',
      overflow: 'hidden',
      width: '100%',
    });

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(docmeeConstructor).toHaveBeenCalled());
  });

  it('shows an error state when Docmee reports an invalid token', async () => {
    render(<PptWorkspace />);

    await waitFor(() => expect(docmeeConstructor).toHaveBeenCalled());

    await emitDocmeeEvent({ type: 'invalid-token' });

    expect(await screen.findByText('服务连接失败')).toBeInTheDocument();
  });

  it('shows an error state when Docmee emits a runtime error', async () => {
    render(<PptWorkspace />);

    await waitFor(() => expect(docmeeConstructor).toHaveBeenCalled());

    await emitDocmeeEvent({
      data: { message: 'iframe failed' },
      type: 'error',
    });

    expect(await screen.findByText('PPT 创作加载失败')).toBeInTheDocument();
  });
});
