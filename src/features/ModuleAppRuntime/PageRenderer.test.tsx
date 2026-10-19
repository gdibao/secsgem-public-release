import type { ModuleAppLaunchContext } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PageRenderer, { type ModuleAppRuntimeManifest } from './PageRenderer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./RecordList', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="record-list">{JSON.stringify(props)}</div>
  ),
}));

vi.mock('./RecordForm', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="record-form">{JSON.stringify(props)}</div>
  ),
}));

vi.mock('./SandboxFrame', () => ({
  default: () => <div data-testid="sandbox-frame" />,
}));

const context: ModuleAppLaunchContext = {
  capability: 'signed-capability',
  displayName: 'Record Desk',
  expiresAt: '2026-07-11T08:05:00.000Z',
  iframeUrl: 'https://runtime.example.com/index.html',
  installationId: '00000000-0000-4000-8000-000000000001',
  nonce: 'launch-nonce-0001',
  runtimeOrigin: 'https://runtime.example.com',
};

const manifest: ModuleAppRuntimeManifest = {
  actions: [
    {
      id: 'create_record',
      inputSchema: {
        fields: [{ key: 'title', label: 'Title', required: true, type: 'text' }],
      },
      moduleMultiplier: 1,
      name: 'Create record',
      outputSchema: {},
      runtimeConfig: {},
      runtimeType: 'record_create',
    },
  ],
  pages: [
    {
      actionBindings: [],
      dataSource: { collectionKey: 'records' },
      key: 'records',
      layoutSchema: {},
      routePath: '/records',
      sortOrder: 0,
      title: 'Records',
      type: 'list',
    },
    {
      actionBindings: [{ actionKey: 'create_record', event: 'submit' }],
      dataSource: { collectionKey: 'records' },
      key: 'record_form',
      layoutSchema: {},
      routePath: '/records/form',
      sortOrder: 1,
      title: 'Record form',
      type: 'form',
    },
  ],
};

describe('PageRenderer', () => {
  it('renders a scoped record list for list pages', () => {
    render(
      <PageRenderer
        appId="00000000-0000-4000-8000-000000000001"
        context={context}
        manifest={manifest}
        pageKey="records"
        workspaceId="workspace-1"
      />,
    );

    expect(screen.getByTestId('record-list')).toHaveTextContent('"collectionKey":"records"');
    expect(screen.getByTestId('record-list')).toHaveTextContent('"scopeType":"workspace"');
    expect(screen.getByTestId('record-list')).toHaveTextContent(
      '"createHref":"/apps/00000000-0000-4000-8000-000000000001/app/record_form?workspaceId=workspace-1&scopeType=workspace"',
    );
    fireEvent.click(screen.getByText('moduleApps.runtime.scope.personal'));
    expect(screen.getByTestId('record-list')).toHaveTextContent('"scopeType":"personal"');
    expect(screen.getByTestId('record-list')).toHaveTextContent(
      '"createHref":"/apps/00000000-0000-4000-8000-000000000001/app/record_form?workspaceId=workspace-1&scopeType=personal"',
    );
  });

  it('restores the selected record scope when navigating to a form', () => {
    render(
      <PageRenderer
        appId="00000000-0000-4000-8000-000000000001"
        context={context}
        initialScopeType="personal"
        manifest={manifest}
        pageKey="record_form"
        workspaceId="workspace-1"
      />,
    );

    expect(screen.getByTestId('record-form')).toHaveTextContent('"scopeType":"personal"');
  });

  it('renders schema-driven create and edit forms for form pages', () => {
    render(
      <PageRenderer
        appId="00000000-0000-4000-8000-000000000001"
        context={context}
        manifest={manifest}
        pageKey="record_form"
        recordId="00000000-0000-4000-8000-000000000010"
      />,
    );

    expect(screen.getByTestId('record-form')).toHaveTextContent('"collectionKey":"records"');
    expect(screen.getByTestId('record-form')).toHaveTextContent('"recordId"');
    expect(screen.getByTestId('record-form')).toHaveTextContent('"key":"title"');
  });

  it('keeps unsupported pages on the sandbox runtime', () => {
    render(
      <PageRenderer
        appId="00000000-0000-4000-8000-000000000001"
        context={context}
        pageKey="custom"
        manifest={{
          actions: [],
          pages: [{ ...manifest.pages[0], key: 'custom', type: 'custom' }],
        }}
      />,
    );

    expect(screen.getByTestId('sandbox-frame')).toBeInTheDocument();
  });
});
