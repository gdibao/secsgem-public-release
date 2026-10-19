import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  rows: [
    {
      id: 'private-a',
      title: 'My edited role',
      avatar: '',
      backgroundColor: null,
      description: '',
    },
    { id: 'private-b', title: 'My other role', avatar: '', backgroundColor: null, description: '' },
  ],
  refresh: vi.fn(),
  create: vi.fn(),
  add: vi.fn(),
  switchGroup: vi.fn(),
  detail: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick }: any) => <button onClick={onClick}>Remove</button>,
  Avatar: () => null,
  Checkbox: ({ checked, onChange, onClick }: any) => (
    <input type="checkbox" checked={checked} onChange={onChange} onClick={onClick} />
  ),
  Flexbox: ({ children }: any) => <div>{children}</div>,
  List: ({ items }: any) => (
    <div>
      {items.map((item: any) => (
        <div key={item.key}>
          {item.title}
          {item.actions}
        </div>
      ))}
    </div>
  ),
  SearchBar: ({ onChange, value }: any) => (
    <input aria-label="Search members" value={value} onChange={onChange} />
  ),
  Text: ({ children }: any) => <span>{children}</span>,
  Tooltip: ({ children }: any) => children,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Switch: () => null,
}));
vi.mock('antd', () => ({
  List: Object.assign(
    ({ dataSource, renderItem }: any) => <div>{dataSource.map(renderItem)}</div>,
    { Item: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div> },
  ),
}));
vi.mock('ahooks', () => ({ useHover: () => false }));
vi.mock('antd-style', () => ({ createStaticStyles: () => ({}), cx: () => '' }));
vi.mock('@/components/ImperativeModal', () => ({
  default: ({ children, footer }: any) => (
    <div role="dialog">
      {children}
      {footer}
    </div>
  ),
}));
vi.mock('@/const/meta', () => ({ DEFAULT_AVATAR: '' }));
vi.mock('@/features/AgentSelectionEmpty', () => ({ default: () => <div>No members</div> }));
vi.mock('@/features/ModelSelect', () => ({ default: () => null }));
vi.mock('@/hooks/useEnabledChatModels', () => ({ useEnabledChatModels: () => [] }));
vi.mock('@/store/session', () => ({ useSessionStore: (select: any) => select({ sessions: [] }) }));
vi.mock('@/libs/swr', () => ({
  useClientDataSWRWithSync: () => ({ data: fixture.rows, mutate: fixture.refresh }),
}));
vi.mock('@/libs/swr/keys', () => ({ agentConfigKeys: { search: () => ['agent:search'] } }));
vi.mock('@/services/agent', () => ({ agentService: { queryAgents: vi.fn() } }));
vi.mock('@/features/LocalAssistantMarket', () => ({
  default: ({ onInstalled }: any) => (
    <button onClick={() => onInstalled('private-b')}>Install selected template</button>
  ),
}));
vi.mock('@lobechat/const', () => ({
  GROUP_CHAT_URL: (id: string) => `/group/${id}`,
  GROUP_CHAT_TOPIC_URL: () => '',
}));
vi.mock('@/services/chatGroup', () => ({
  chatGroupService: { createGroup: fixture.create, addAgentsToGroup: fixture.add },
}));
vi.mock('@/store/chat', () => ({ useChatStore: {} }));
vi.mock('@/store/home', () => ({
  getHomeStoreState: () => ({
    refreshAgentList: fixture.refresh,
    switchToGroup: fixture.switchGroup,
  }),
}));

import MemberSelectionModal from '@/components/MemberSelectionModal/MemberSelectionModal';
import { ChatGroupLifecycleAction } from '@/store/agentGroup/slices/lifecycle';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  fixture.create.mockResolvedValue({ group: { id: 'native-group' } });
  fixture.add.mockResolvedValue({ added: ['private-a', 'private-b'] });
  fixture.refresh.mockResolvedValue(fixture.rows);
});

it('passes selected current native agent IDs to native group creation and member persistence', async () => {
  const lifecycle = new ChatGroupLifecycleAction(
    null,
    () =>
      ({
        internal_dispatchChatGroup: fixture.dispatch,
        internal_fetchGroupDetail: fixture.detail,
      }) as any,
  );
  const submit = vi.fn(async (ids: string[]) => {
    await lifecycle.createGroup({}, ids);
  });
  render(<MemberSelectionModal mode="create" open onCancel={vi.fn()} onConfirm={submit} />);
  expect(
    (screen.getByRole('button', { name: /memberSelection.createGroup/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByText('My edited role'));
  fireEvent.click(screen.getByText('My other role'));
  fireEvent.click(screen.getByRole('button', { name: /memberSelection.createGroup/ }));
  await waitFor(() => expect(fixture.switchGroup).toHaveBeenCalledWith('native-group'));
  expect(submit).toHaveBeenCalledWith(['private-a', 'private-b'], undefined, true);
  expect(fixture.add).toHaveBeenCalledWith('native-group', ['private-a', 'private-b']);
  expect(fixture.detail).toHaveBeenCalledWith('native-group');
});

it('selects a user-installed template and preserves selection after failure for retry', async () => {
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error('native failure'))
    .mockResolvedValue(undefined);
  render(<MemberSelectionModal mode="create" open onCancel={vi.fn()} onConfirm={submit} />);
  fireEvent.click(screen.getByRole('button', { name: 'Local assistants' }));
  fireEvent.click(screen.getByText('Install selected template'));
  await waitFor(() => expect(fixture.refresh).toHaveBeenCalled());
  const confirm = screen.getByRole('button', { name: /memberSelection.createGroup/ });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  await screen.findByRole('alert');
  expect(submit).toHaveBeenLastCalledWith(['private-b'], undefined, true);
  fireEvent.click(confirm);
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit).toHaveBeenLastCalledWith(['private-b'], undefined, true);
});
