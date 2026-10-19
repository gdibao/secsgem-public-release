import { memo } from 'react';

import type { ModuleAppArtifactRow } from './types';

export type ArtifactsTableLabels = {
  artifact?: string;
  file?: string;
  mime?: string;
  scope?: string;
  size?: string;
  storageKey?: string;
};

interface ArtifactsTableProps {
  items?: ModuleAppArtifactRow[];
  labels?: ArtifactsTableLabels;
  loading?: boolean;
}

const ArtifactsTable = memo<ArtifactsTableProps>(({ items = [], labels, loading }) => {
  const resolvedLabels = {
    artifact: 'Artifact',
    file: 'File',
    mime: 'MIME',
    scope: 'Scope',
    size: 'Size',
    storageKey: 'Storage key',
    ...labels,
  };

  if (loading) {
    return <div data-testid="admin-module-app-artifacts">Loading artifacts</div>;
  }

  if (items.length === 0) {
    return <div data-testid="admin-module-app-artifacts">No artifacts</div>;
  }

  return (
    <table data-testid="admin-module-app-artifacts">
      <thead>
        <tr>
          <th>{resolvedLabels.artifact}</th>
          <th>{resolvedLabels.scope}</th>
          <th>{resolvedLabels.file}</th>
          <th>{resolvedLabels.mime}</th>
          <th>{resolvedLabels.size}</th>
          <th>{resolvedLabels.storageKey}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.id}</td>
            <td>{item.scopeType ?? '-'}</td>
            <td>{item.fileName ?? '-'}</td>
            <td>{item.mimeType ?? '-'}</td>
            <td>
              {item.sizeBytes === undefined || item.sizeBytes === null ? '-' : item.sizeBytes}
            </td>
            <td>{item.storageKey ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

ArtifactsTable.displayName = 'ArtifactsTable';

export default ArtifactsTable;
