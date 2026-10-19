import { memo } from 'react';

import type { ModuleAppRecordRow } from './types';

export type RecordsTableLabels = {
  collection?: string;
  record?: string;
  scope?: string;
  status?: string;
  updated?: string;
};

interface RecordsTableProps {
  items?: ModuleAppRecordRow[];
  labels?: RecordsTableLabels;
  loading?: boolean;
}

const RecordsTable = memo<RecordsTableProps>(({ items = [], labels, loading }) => {
  const resolvedLabels = {
    collection: 'Collection',
    record: 'Record',
    scope: 'Scope',
    status: 'Status',
    updated: 'Updated',
    ...labels,
  };

  if (loading) {
    return <div data-testid="admin-module-app-records">Loading records</div>;
  }

  if (items.length === 0) {
    return <div data-testid="admin-module-app-records">No records</div>;
  }

  return (
    <table data-testid="admin-module-app-records">
      <thead>
        <tr>
          <th>{resolvedLabels.record}</th>
          <th>{resolvedLabels.collection}</th>
          <th>{resolvedLabels.scope}</th>
          <th>{resolvedLabels.status}</th>
          <th>{resolvedLabels.updated}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.title ?? item.id}</td>
            <td>{item.collectionKey}</td>
            <td>{item.scopeType}</td>
            <td>{item.status ?? '-'}</td>
            <td>{item.updatedAt ? String(item.updatedAt) : '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

RecordsTable.displayName = 'RecordsTable';

export default RecordsTable;
