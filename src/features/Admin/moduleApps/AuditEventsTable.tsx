import { memo } from 'react';

import type { ModuleAppAuditRow } from './types';

export type AuditEventsTableLabels = {
  actor?: string;
  audit?: string;
  created?: string;
  event?: string;
};

interface AuditEventsTableProps {
  items?: ModuleAppAuditRow[];
  labels?: AuditEventsTableLabels;
  loading?: boolean;
}

const formatDate = (value?: Date | string) => (value ? String(value) : '-');

const AuditEventsTable = memo<AuditEventsTableProps>(({ items = [], labels, loading }) => {
  const resolvedLabels = {
    actor: 'Actor',
    audit: 'Audit',
    created: 'Created',
    event: 'Event',
    ...labels,
  };

  if (loading) return <div data-testid="admin-module-app-audit-events">Loading audit events</div>;
  if (items.length === 0)
    return <div data-testid="admin-module-app-audit-events">No audit events</div>;

  return (
    <table data-testid="admin-module-app-audit-events">
      <thead>
        <tr>
          <th>{resolvedLabels.audit}</th>
          <th>{resolvedLabels.event}</th>
          <th>{resolvedLabels.actor}</th>
          <th>{resolvedLabels.created}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.id}</td>
            <td>{item.eventType}</td>
            <td>{item.actorUserId ?? '-'}</td>
            <td>{formatDate(item.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

AuditEventsTable.displayName = 'AuditEventsTable';

export default AuditEventsTable;
