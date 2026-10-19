import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SkillSourceTag from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'skillStore.tabs.lobehub' ? '驰拓AI' : key),
  }),
}));

vi.mock('@/features/Brand', () => ({
  useBrandName: () => '驰拓AI',
}));

describe('SkillSourceTag', () => {
  it('uses the configured brand label for builtin skills', () => {
    render(<SkillSourceTag source="builtin" />);

    expect(screen.getByText('驰拓AI')).toBeInTheDocument();
    expect(screen.queryByText('LobeHub')).not.toBeInTheDocument();
  });
});
