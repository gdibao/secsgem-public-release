declare module 'react-layout-kit' {
  import type { CSSProperties, FC, HTMLAttributes, ReactNode } from 'react';

  export interface FlexboxProps extends HTMLAttributes<HTMLDivElement> {
    align?: CSSProperties['alignItems'];
    as?: keyof JSX.IntrinsicElements;
    children?: ReactNode;
    distribution?: CSSProperties['justifyContent'];
    flex?: CSSProperties['flex'];
    gap?: number | string;
    height?: number | string;
    horizontal?: boolean;
    justify?: CSSProperties['justifyContent'];
    padding?: number | string;
    paddingBlock?: number | string;
    paddingInline?: number | string;
    style?: CSSProperties;
    width?: number | string;
    wrap?: CSSProperties['flexWrap'];
  }

  export const Flexbox: FC<FlexboxProps>;
  export const Center: FC<FlexboxProps>;
  export const HStack: FC<FlexboxProps>;
  export const VStack: FC<FlexboxProps>;

  export default Flexbox;
}
