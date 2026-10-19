import type { MouseEventHandler } from 'react';

declare module '@lobehub/ui' {
  interface ActionIconProps {
    onClick?: MouseEventHandler<HTMLElement>;
  }
}
