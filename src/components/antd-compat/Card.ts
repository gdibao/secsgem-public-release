import { Card as AntdCard, type CardProps } from 'antd';
import { createElement, type ReactElement } from 'react';

export const Card = (props: CardProps): ReactElement => createElement(AntdCard as any, props);

export type { CardProps };
