import { Image as AntdImage, type ImageProps } from 'antd';
import { createElement, type ReactElement } from 'react';

export const Image = (props: ImageProps): ReactElement => createElement(AntdImage as any, props);

export type { ImageProps };
