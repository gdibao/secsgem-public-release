import { ORG_NAME } from '@lobechat/business-const';
import { type LobeHubProps } from '@lobehub/ui/brand';
import { memo } from 'react';

import { isCustomORG } from '@/const/version';

export const OrgBrand = memo<LobeHubProps>((props) => {
  if (isCustomORG) {
    return <span>{ORG_NAME}</span>;
  }

  return <span>无锡市驰拓信息科技有限公司</span>;
});
