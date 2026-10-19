import { memo } from 'react';

import type { ModuleAppInstallRow } from './types';

export type InstallsTableLabels = {
  install?: string;
  installed?: string;
  scope?: string;
  status?: string;
  user?: string;
  workspace?: string;
};

interface InstallsTableProps {
  items?: ModuleAppInstallRow[];
  labels?: InstallsTableLabels;
  loading?: boolean;
}

const formatDate = (value?: Date | string) => (value ? String(value) : '-');

const InstallsTable = memo<InstallsTableProps>(({ items = [], labels, loading }) => {
  const resolvedLabels = {
    install: 'Install',
    installed: 'Installed',
    scope: 'Scope',
    status: 'Status',
    user: 'User',
    workspace: 'Workspace',
    ...labels,
  };

  if (loading) return <div data-testid="admin-module-app-installs">Loading installs</div>;
  if (items.length === 0) return <div data-testid="admin-module-app-installs">No installs</div>;

  return (
    <table data-testid="admin-module-app-installs">
      <thead>
        <tr>
          <th>{resolvedLabels.install}</th>
          <th>{resolvedLabels.scope}</th>
          <th>{resolvedLabels.status}</th>
          <th>{resolvedLabels.user}</th>
          <th>{resolvedLabels.workspace}</th>
          <th>{resolvedLabels.installed}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.id}</td>
            <td>{item.scopeType ?? '-'}</td>
            <td>{item.status ?? '-'}</td>
            <td>{item.userId ?? '-'}</td>
            <td>{item.workspaceId ?? '-'}</td>
            <td>{formatDate(item.installedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

InstallsTable.displayName = 'InstallsTable';

export default InstallsTable;
