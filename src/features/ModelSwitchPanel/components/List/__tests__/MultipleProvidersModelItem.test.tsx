/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type * as ModelSelectModule from '@/components/ModelSelect';

import { MultipleProvidersModelItem } from '../MultipleProvidersModelItem';

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroupLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  DropdownMenuItemIcon: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  DropdownMenuItemLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  DropdownMenuPopup: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DropdownMenuPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuPositioner: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubmenuRoot: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubmenuTrigger: ({
    children,
    className,
    onClick,
    style,
  }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className} style={style} onClick={onClick}>
      {children}
    </div>
  ),
  Tooltip: ({ children, title }: { children: ReactNode; title: string }) => (
    <span data-testid={`tooltip-${title}`}>{children}</span>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Avatar: () => <span />,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Text: ({
    children,
    style,
    title,
  }: {
    children: ReactNode;
    style?: HTMLAttributes<HTMLSpanElement>['style'];
    title?: string;
  }) => (
    <span style={style} title={title}>
      {children}
    </span>
  ),
}));

vi.mock('@lobehub/icons', () => ({
  LobeHub: { Morden: () => <span /> },
}));

vi.mock('@/components/LobeIcons', () => ({
  ModelIcon: () => <span />,
  ProviderIcon: () => <span />,
}));

vi.mock('antd-style', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createStaticStyles: () => ({
    container: 'container',
    detailPopup: 'detailPopup',
    dropdownMenu: 'dropdownMenu',
    tag: 'tag',
    token: 'token',
  }),
  cx: (...classNames: Array<string | undefined>) => classNames.filter(Boolean).join(' '),
  useResponsive: () => ({ mobile: false }),
}));

vi.mock('@/components/ModelSelect', () => ({
  ModelItemRender: ({
    displayName,
    proBadgeLabel,
  }: {
    displayName: string;
    proBadgeLabel?: string;
  }) => (
    <div>
      {displayName}
      {proBadgeLabel && <span data-testid="model-pro-badge">{proBadgeLabel}</span>}
    </div>
  ),
  ProviderItemRender: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock('../../ModelDetailPanel', () => ({
  default: ({ model, provider }: { model: string; provider: string }) => (
    <div data-testid="model-detail-panel">
      {provider}/{model}
    </div>
  ),
}));

describe('MultipleProvidersModelItem', () => {
  it('renders the audio capability tag from flattened model abilities', async () => {
    const { ModelItemRender } = await vi.importActual<typeof ModelSelectModule>(
      '@/components/ModelSelect',
    );

    render(<ModelItemRender audio id="gemini-audio" />);

    expect(screen.getByTestId('tooltip-ModelSelect.featureTag.audio')).toBeInTheDocument();
  });

  it('keeps spread model card fields off the DOM', async () => {
    const { ModelItemRender } = await vi.importActual<typeof ModelSelectModule>(
      '@/components/ModelSelect',
    );
    const modelCardProps = {
      id: 'deepseek-v3',
      knowledgeCutoff: '2025-01',
      reasoning: true,
      search: true,
      structuredOutput: true,
    };

    const { container } = render(<ModelItemRender {...modelCardProps} />);

    for (const attr of ['reasoning', 'search', 'structuredoutput', 'knowledgecutoff']) {
      expect(container.querySelector(`[${attr}]`)).toBeNull();
    }
  });

  it('lets model metadata wrap without truncating the model name', async () => {
    const { ModelItemRender } = await vi.importActual<typeof ModelSelectModule>(
      '@/components/ModelSelect',
    );
    const displayName = 'gemini-3.7-flash-preview-with-a-long-name';

    render(
      <ModelItemRender
        wrapInfo
        displayName={displayName}
        id="gemini-3.7-flash-preview"
        priceLabel={<span>price summary</span>}
      />,
    );

    const name = screen.getByText(displayName);
    const price = screen.getByText('price summary');

    expect(name).toHaveAttribute('title', displayName);
    expect(name).toHaveStyle({ overflowWrap: 'anywhere', whiteSpace: 'normal' });
    expect(name.parentElement).not.toBe(price.parentElement);
    expect(name.parentElement?.parentElement).toBe(price.parentElement?.parentElement);
    expect(name.parentElement?.parentElement).toHaveStyle({ '--lobe-flex-wrap': 'wrap' });
  });

  it('renders model detail panel even when info tags are hidden', () => {
    render(
      <MultipleProvidersModelItem
        activeKey="lobehub/gpt-5.4"
        enabledList={[]}
        newLabel="new"
        data={{
          displayName: 'GPT-5.4',
          model: {
            abilities: {},
            displayName: 'GPT-5.4',
            id: 'gpt-5.4',
          } as any,
          providers: [
            { id: 'lobehub', name: 'LobeHub' },
            { id: 'openai', name: 'OpenAI' },
          ],
        }}
        onClose={vi.fn()}
        onModelChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('model-detail-panel')).toHaveTextContent('lobehub/gpt-5.4');
    expect(screen.getByText('ModelSwitchPanel.useModelFrom')).toBeInTheDocument();
  });

  it('uses the restricted handler when the default provider is restricted', () => {
    const onClose = vi.fn();
    const onModelChange = vi.fn();
    const onRestrictedModelClick = vi.fn();

    render(
      <MultipleProvidersModelItem
        activeKey="anthropic/claude-opus-4-7"
        enabledList={[]}
        newLabel="new"
        proLabel="pro"
        data={{
          displayName: 'Claude Opus 4.7',
          model: {
            abilities: {},
            displayName: 'Claude Opus 4.7',
            id: 'claude-opus-4-7',
          } as any,
          providers: [
            { id: 'lobehub', name: 'LobeHub' },
            { id: 'anthropic', name: 'Anthropic' },
          ],
        }}
        isModelRestricted={(modelId, providerId) =>
          modelId === 'claude-opus-4-7' && providerId === 'lobehub'
        }
        onClose={onClose}
        onModelChange={onModelChange}
        onRestrictedModelClick={onRestrictedModelClick}
      />,
    );

    fireEvent.click(screen.getByText('Claude Opus 4.7'));

    expect(onRestrictedModelClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onModelChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('model-pro-badge')).toHaveTextContent('pro');
  });

  it('should only change the model when the before-select guard approves', async () => {
    const onModelChange = vi.fn();
    const onBeforeModelSelect = vi.fn().mockResolvedValue(false);

    render(
      <MultipleProvidersModelItem
        activeKey=""
        enabledList={[]}
        newLabel="new"
        data={{
          displayName: 'Claude Opus 4.8',
          model: {
            abilities: {},
            displayName: 'Claude Opus 4.8',
            id: 'claude-opus-4-8',
          } as any,
          providers: [{ id: 'lobehub', name: 'LobeHub' }],
        }}
        onBeforeModelSelect={onBeforeModelSelect}
        onClose={vi.fn()}
        onModelChange={onModelChange}
      />,
    );

    fireEvent.click(screen.getByText('Claude Opus 4.8'));

    expect(onBeforeModelSelect).toHaveBeenCalledWith('claude-opus-4-8', 'lobehub');
    await vi.waitFor(() => expect(onModelChange).not.toHaveBeenCalled());
  });

  it('renders the official Pro badge without restricting model selection', async () => {
    const onModelChange = vi.fn();

    render(
      <MultipleProvidersModelItem
        activeKey=""
        enabledList={[]}
        isModelPro={(modelId) => modelId === 'claude-sonnet-4-6'}
        newLabel="new"
        proLabel="Pro"
        data={{
          displayName: 'Claude Sonnet 4.6',
          model: {
            abilities: {},
            displayName: 'Claude Sonnet 4.6',
            id: 'claude-sonnet-4-6',
          } as any,
          providers: [{ id: 'newapi', name: 'NewAPI' }],
        }}
        onClose={vi.fn()}
        onModelChange={onModelChange}
      />,
    );

    expect(screen.getByTestId('model-pro-badge')).toHaveTextContent('Pro');
    fireEvent.click(screen.getByText('Claude Sonnet 4.6'));
    await vi.waitFor(() =>
      expect(onModelChange).toHaveBeenCalledWith('claude-sonnet-4-6', 'newapi'),
    );
  });
});
