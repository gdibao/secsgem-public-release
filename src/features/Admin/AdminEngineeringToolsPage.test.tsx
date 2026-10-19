import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminEngineeringToolsPage from './AdminEngineeringToolsPage';

const mocks = vi.hoisted(() => ({
  menu: {
    items: [
      { enabled: true, key: 'image', label: '工艺与厂务', path: '/engineering-tools?section=process', sortOrder: 0 },
      { enabled: true, key: 'ppt', label: '自动化与网络', path: '/engineering-tools?section=automation', sortOrder: 1 },
      { enabled: true, key: 'community', label: '设计与项目', path: '/engineering-tools?section=design', sortOrder: 2 },
    ],
    version: 4,
  },
  menuMutate: vi.fn(),
  toolsMutate: vi.fn(),
  saveMenuCAS: vi.fn(),
  saveTool: vi.fn(),
  saveVocabulary: vi.fn(),
  tool: {
    availability: 'Unconfigured',
    category: 'Piping',
    description: '',
    developerOnly: false,
    enabled: true,
    id: 'PG001',
    launchUrl: null,
    license: 'Check vendor terms',
    name: 'Example',
    publicReason: '获取路径待核',
    section: 'process',
    shape: 'web',
    sortOrder: 1,
    sourceUrl: 'https://example.com/product',
    summary: '',
  },
}));

vi.mock('@/features/Admin/layout', () => ({
  AdminPageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/features/EngineeringTools/SubmissionReviewPanel', () => ({
  default: ({ onCatalogChange }: { onCatalogChange?: () => void }) =>
    <button onClick={onCatalogChange}>模拟审核发布</button>,
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { role: string }) => unknown) => selector({ role: 'admin' }),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: (state: { role: string }) => state },
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    engineeringTools: {
      adminList: { query: vi.fn() },
      adminMenuState: { query: vi.fn() },
      adminVocabulary: { query: vi.fn() },
      save: { mutate: mocks.saveTool },
      saveMenuCAS: { mutate: mocks.saveMenuCAS },
      saveVocabulary: { mutate: mocks.saveVocabulary },
    },
  },
}));
vi.mock('swr', () => ({
  default: (key: string) => ({
    data: key === 'engineering-tools-admin-menu-state' ? mocks.menu : key.includes('list') ? [mocks.tool] : key.includes('vocabulary') ? {
      accessStates: [], forms: [], licenseTypes: [], maintainerNames: [], operatingSystems: [],
      pricingTypes: [], projectPhases: [], subsystems: ['UPW'], vendorNames: [],
    } : null,
    mutate: key === 'engineering-tools-admin-menu-state' ? mocks.menuMutate : key === 'engineering-tools-admin-list' ? mocks.toolsMutate : vi.fn(),
  }),
}));

describe('AdminEngineeringToolsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.menu.version = 4;
    mocks.menu.items[0].label = '工艺与厂务';
  });

  it('locks the stable ID while editing an existing tool', () => {
    render(<AdminEngineeringToolsPage />);
    fireEvent.click(screen.getByRole('button', { name: '编辑 Example' }));
    expect((screen.getByLabelText('稳定 ID') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('稳定 ID') as HTMLInputElement).value).toBe('PG001');
  });

  it('keeps the public archive reason editable through the admin tool form', async () => {
    mocks.saveTool.mockResolvedValue({});
    render(<AdminEngineeringToolsPage />);
    fireEvent.click(screen.getByRole('button', { name: '编辑 Example' }));
    const reason = screen.getByLabelText('公开归档原因');
    expect((reason as HTMLInputElement).value).toBe('获取路径待核');
    fireEvent.change(reason, { target: { value: '需厂商授权，运行入口尚未核验' } });
    fireEvent.click(screen.getByRole('button', { name: /^保存$/ }));
    await waitFor(() => expect(mocks.saveTool).toHaveBeenCalledWith(expect.objectContaining({
      id: 'PG001', publicReason: '需厂商授权，运行入口尚未核验',
    })));
  });

  it('opens submission review in the existing admin page and refreshes the directory after publication', () => {
    render(<AdminEngineeringToolsPage />);
    fireEvent.click(screen.getByRole('tab', { name: '投稿审核' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟审核发布' }));
    expect(mocks.toolsMutate).toHaveBeenCalledOnce();
  });

  it('lets an administrator add a vocabulary term through the real tab', async () => {
    mocks.saveVocabulary.mockResolvedValue({});
    render(<AdminEngineeringToolsPage />);
    fireEvent.click(screen.getByRole('tab', { name: '分类词表' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑词表' }));
    fireEvent.change(screen.getByLabelText('新增词'), { target: { value: '化学配管' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.click(screen.getByRole('button', { name: '保存词表' }));
    await waitFor(() => expect(mocks.saveVocabulary).toHaveBeenCalledWith(expect.objectContaining({
      subsystems: ['UPW', '化学配管'],
    })));
  });

  it('saves menu edits with the version observed before editing', async () => {
    mocks.saveMenuCAS.mockResolvedValue({ version: 5 });
    render(<AdminEngineeringToolsPage />);
    fireEvent.click(screen.getByRole('tab', { name: '侧栏入口' }));
    fireEvent.change(screen.getByLabelText('image 名称'), { target: { value: '工程目录' } });
    mocks.menu.version = 5;
    fireEvent.click(screen.getByRole('button', { name: '保存菜单' }));
    await waitFor(() => expect(mocks.saveMenuCAS).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 4,
      items: expect.arrayContaining([expect.objectContaining({ key: 'image', label: '工程目录' })]),
    })));
  });

  it('preserves unsaved menu edits after a concurrent save conflict', async () => {
    mocks.saveMenuCAS.mockRejectedValue({ data: { code: 'CONFLICT' }, message: 'Menu changed' });
    const { rerender } = render(<AdminEngineeringToolsPage />);
    fireEvent.click(screen.getByRole('tab', { name: '侧栏入口' }));
    fireEvent.change(screen.getByLabelText('image 名称'), { target: { value: '我的未保存名称' } });
    mocks.menu.version = 5;
    mocks.menu.items[0].label = '其他管理员的新名称';
    rerender(<AdminEngineeringToolsPage />);
    fireEvent.click(screen.getByRole('button', { name: '保存菜单' }));
    await screen.findByRole('alert');
    expect(mocks.saveMenuCAS).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4 }));
    expect((screen.getByLabelText('image 名称') as HTMLInputElement).value).toBe('我的未保存名称');
    expect((screen.getByRole('button', { name: '保存菜单' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.menuMutate).toHaveBeenCalled();
  });
});
