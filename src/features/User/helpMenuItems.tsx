import { sanitizeLinkUrl } from '@lobechat/utils';
import type { ReactNode } from 'react';

import type { PublicCustomizationConfig } from '@/types/serverConfig';

type HelpMenuItem = NonNullable<PublicCustomizationConfig['helpMenuItems']>[number];

export interface CustomHelpMenuItem {
  key: string;
  label: ReactNode;
}

export const buildCustomHelpMenuItems = (items: HelpMenuItem[] = []): CustomHelpMenuItem[] =>
  items
    .map((item, index) => ({
      ...item,
      index,
      label: item.label.trim(),
      url: sanitizeLinkUrl(item.url),
    }))
    .filter((item) => item.label)
    .map((item, index) => ({
      key: `custom-help-${index}`,
      label: item.url ? (
        <a href={item.url} rel="noopener noreferrer" target="_blank">
          {item.label}
        </a>
      ) : (
        <span>{item.label}</span>
      ),
    }));
