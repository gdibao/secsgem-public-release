import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BrandTextLoading from './index';

vi.mock('@/features/Brand', () => ({
  useBrand: () => ({
    loadingText: '正在进入驰拓AI',
    name: '驰拓AI',
    slogan: '不应作为加载文案',
  }),
}));

describe('BrandTextLoading', () => {
  it('renders a single generic loading message instead of runtime brand copy', () => {
    render(<BrandTextLoading debugId="Image Page" />);

    expect(screen.getByRole('status', { name: '加载中' })).toBeInTheDocument();
    expect(screen.getByText('加载中')).toBeInTheDocument();
    expect(screen.queryByText('正在进入驰拓AI')).not.toBeInTheDocument();
    expect(screen.queryByText('LobeHub')).not.toBeInTheDocument();
  });
});
