import { Outlet, useLocation } from 'react-router';

import LocalAssistantMarket from '@/features/LocalAssistantMarket';
import {
  isLocalAssistantMarketPath,
  isLocalMarketOverviewPath,
  localMarketKindFromPath,
} from '@/features/LocalAssistantMarket/catalog';
import LocalMarketCatalog from '@/features/LocalMarket/LocalMarketCatalog';
import LocalMarketOverview from '@/features/LocalMarket/LocalMarketOverview';

const Layout = () => {
  const { pathname } = useLocation();
  const marketKind = localMarketKindFromPath(pathname);
  if (isLocalAssistantMarketPath(pathname)) return <LocalAssistantMarket />;
  if (isLocalMarketOverviewPath(pathname)) return <LocalMarketOverview />;
  if (marketKind) return <LocalMarketCatalog kind={marketKind} />;

  return <Outlet />;
};

export default Layout;
