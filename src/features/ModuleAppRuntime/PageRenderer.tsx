import {
  type ModuleAppActionConfig,
  moduleAppInputSchema,
  type ModuleAppLaunchContext,
  type ModuleAppPage,
  type ModuleAppScopeType,
} from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useMemo, useState } from 'react';

import RecordForm from './RecordForm';
import RecordList from './RecordList';
import SandboxFrame from './SandboxFrame';
import ScopeSwitch from './ScopeSwitch';

const styles = createStaticStyles(({ css, cssVar }) => ({
  controls: css`
    padding: 16px 24px 0;
    background: ${cssVar.colorBgLayout};
  `,
  hostPage: css`
    width: 100%;
    min-width: 0;
    height: 100%;
    overflow: auto;
    background: ${cssVar.colorBgLayout};
  `,
}));

export interface ModuleAppRuntimeManifest {
  actions: ModuleAppActionConfig[];
  pages: ModuleAppPage[];
}

interface PageRendererProps {
  appId?: string;
  context: ModuleAppLaunchContext;
  initialScopeType?: ModuleAppScopeType;
  manifest?: ModuleAppRuntimeManifest | null;
  pageKey?: string;
  recordId?: string;
  workspaceId?: string;
}

const getCollectionKey = (page?: ModuleAppPage) => {
  const collectionKey = page?.dataSource.collectionKey;
  return typeof collectionKey === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(collectionKey)
    ? collectionKey
    : undefined;
};

const getFormFields = (manifest: ModuleAppRuntimeManifest, page: ModuleAppPage) => {
  const submitBinding = page.actionBindings.find((binding) => binding.event === 'submit');
  const action = submitBinding
    ? manifest.actions.find((item) => item.id === submitBinding.actionKey)
    : undefined;
  if (action) return action.inputSchema.fields;

  const parsed = moduleAppInputSchema.safeParse({ fields: page.layoutSchema.fields });
  return parsed.success ? parsed.data.fields : [];
};

const buildHostPageHref = (input: {
  appId: string;
  pageKey: string;
  recordId?: string;
  scopeType: ModuleAppScopeType;
  workspaceId?: string;
}) => {
  const search = new URLSearchParams();
  if (input.workspaceId) search.set('workspaceId', input.workspaceId);
  search.set('scopeType', input.scopeType);
  if (input.recordId) search.set('recordId', input.recordId);
  const query = search.toString();
  return `/apps/${input.appId}/app/${input.pageKey}${query ? `?${query}` : ''}`;
};

const PageRenderer = memo<PageRendererProps>(
  ({ appId, context, initialScopeType, manifest, pageKey, recordId, workspaceId }) => {
    const [scopeType, setScopeType] = useState<ModuleAppScopeType>(
      initialScopeType ?? (workspaceId ? 'workspace' : 'personal'),
    );
    const page = useMemo(
      () => manifest?.pages.find((item) => item.key === pageKey),
      [manifest?.pages, pageKey],
    );
    const collectionKey = getCollectionKey(page);
    const formPage = useMemo(
      () =>
        manifest?.pages.find(
          (item) => item.type === 'form' && getCollectionKey(item) === collectionKey,
        ),
      [collectionKey, manifest?.pages],
    );

    useEffect(() => {
      setScopeType(initialScopeType ?? (workspaceId ? 'workspace' : 'personal'));
    }, [initialScopeType, workspaceId]);

    if (!appId || !manifest || !page || !collectionKey) {
      return <SandboxFrame context={context} title={context.displayName} />;
    }

    if (page.type !== 'list' && page.type !== 'form') {
      return <SandboxFrame context={context} title={context.displayName} />;
    }

    return (
      <Flexbox className={styles.hostPage} data-testid="module-app-host-page">
        <Flexbox horizontal className={styles.controls}>
          <ScopeSwitch
            scopeType={scopeType}
            workspaceId={workspaceId}
            onChange={setScopeType}
          />
        </Flexbox>
        {page.type === 'list' ? (
          <RecordList
            appId={appId}
            collectionKey={collectionKey}
            scopeType={scopeType}
            workspaceId={workspaceId}
            createHref={
              formPage
                ? buildHostPageHref({
                    appId,
                    pageKey: formPage.key,
                    scopeType,
                    workspaceId,
                  })
                : undefined
            }
            editHref={
              formPage
                ? (record) =>
                    buildHostPageHref({
                      appId,
                      pageKey: formPage.key,
                      recordId: record.id,
                      scopeType,
                      workspaceId,
                    })
                : undefined
            }
          />
        ) : (
          <RecordForm
            appId={appId}
            collectionKey={collectionKey}
            fields={getFormFields(manifest, page)}
            recordId={recordId}
            scopeType={scopeType}
            workspaceId={workspaceId}
          />
        )}
      </Flexbox>
    );
  },
);

PageRenderer.displayName = 'PageRenderer';

export default PageRenderer;
