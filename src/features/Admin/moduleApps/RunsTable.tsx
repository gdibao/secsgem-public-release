import { memo } from 'react';

import type { ModuleAppRunRow } from './types';

export type RunsTableLabels = {
  action?: string;
  created?: string;
  duration?: string;
  error?: string;
  run?: string;
  status?: string;
};

interface RunsTableProps {
  items?: ModuleAppRunRow[];
  labels?: RunsTableLabels;
  loading?: boolean;
}

const RunsTable = memo<RunsTableProps>(({ items = [], labels, loading }) => {
  const resolvedLabels = {
    action: 'Action',
    created: 'Created',
    duration: 'Duration',
    error: 'Error',
    run: 'Run',
    status: 'Status',
    ...labels,
  };

  if (loading) {
    return <div data-testid="admin-module-app-runs">Loading runs</div>;
  }

  if (items.length === 0) {
    return <div data-testid="admin-module-app-runs">No runs</div>;
  }

  return (
    <table data-testid="admin-module-app-runs">
      <thead>
        <tr>
          <th>{resolvedLabels.run}</th>
          <th>{resolvedLabels.action}</th>
          <th>{resolvedLabels.status}</th>
          <th>{resolvedLabels.error}</th>
          <th>{resolvedLabels.duration}</th>
          <th>{resolvedLabels.created}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.id}</td>
            <td>{item.actionId ?? '-'}</td>
            <td>{item.status}</td>
            <td>{item.errorType ?? '-'}</td>
            <td>
              {item.durationMs === undefined || item.durationMs === null
                ? '-'
                : `${item.durationMs}ms`}
            </td>
            <td>{item.createdAt ? String(item.createdAt) : '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

RunsTable.displayName = 'RunsTable';

export default RunsTable;
