import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet, useLocation } from 'react-router';

import LocalAssistantMarket from '@/features/LocalAssistantMarket';
import {
  isLocalAssistantMarketPath,
  isLocalMarketOverviewPath,
  localMarketKindFromPath,
} from '@/features/LocalAssistantMarket/catalog';
import LocalMarketCatalog from '@/features/LocalMarket/LocalMarketCatalog';
import LocalMarketOverview from '@/features/LocalMarket/LocalMarketOverview';

import Sidebar from './Sidebar';
import { styles } from './style';

const Layout: FC = () => {
  const { pathname } = useLocation();
  const marketKind = localMarketKindFromPath(pathname);
  if (isLocalAssistantMarketPath(pathname) || isLocalMarketOverviewPath(pathname) || marketKind) {
    return (
      <>
        <Sidebar />
        <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
          {isLocalAssistantMarketPath(pathname) ? (
            <LocalAssistantMarket />
          ) : isLocalMarketOverviewPath(pathname) ? (
            <LocalMarketOverview />
          ) : (
            <LocalMarketCatalog kind={marketKind!} />
          )}
        </Flexbox>
      </>
    );
  }

  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <Outlet />
      </Flexbox>
    </>
  );
};

export default Layout;
