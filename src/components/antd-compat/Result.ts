import { Result as AntdResult, type ResultProps } from 'antd';
import { createElement, type ReactElement } from 'react';

export const Result = (props: ResultProps): ReactElement => createElement(AntdResult as any, props);

export type { ResultProps };
