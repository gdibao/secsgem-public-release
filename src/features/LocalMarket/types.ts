export type LocalMarketKind = 'skills' | 'mcp' | 'models' | 'providers';

export interface LocalMarketItem {
  author: string;
  category?: string;
  description: string;
  homepage?: string;
  id: string;
  installable: boolean;
  name: string;
  score?: number;
  source: 'fab' | 'quality' | 'runtime' | 'local-mirror';
  stars?: number;
  sourceId?: string;
  status?: 'installable' | 'needs-config' | 'metadata-only' | 'blocked' | 'ready';
  missing?: string[];
  installCount?: number;
  license?: string;
  permissions?: string[];
  ratingCount?: number;
  featured?: boolean;
  official?: boolean;
  updatedAt?: string;
  avatar?: string;
  version?: string;
  sha256?: string;
  toolsCount?: number;
  transport?: string;
}
