import { render, screen } from '@testing-library/react';

import Notification from './Notification';

const { mockIsDesktop, mockNotificationConfig } = vi.hoisted(() => ({
  mockIsDesktop: vi.fn(() => true),
  mockNotificationConfig: vi.fn(() => ({
    desktopEnabled: true,
    emailEnabled: false,
    inboxEnabled: true,
    system: {
      actionUrl: null as string | null,
      content: '',
      enabled: false,
      title: '',
    },
  })),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  get isDesktop() {
    return mockIsDesktop();
  },
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({
    data: mockNotificationConfig(),
  }),
}));

vi.mock('@/features/Settings/features/SettingHeader', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock('@/services/adminCommercial', () => ({
  adminCommercialService: {
    getPublicNotificationConfig: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      ({
        'notification.email.desc': '重要事件发生时接收邮件通知。',
        'notification.email.title': '邮件通知',
        'notification.enabled': '已启用',
        'notification.inbox.desc': '在站内收件箱显示通知。',
        'notification.inbox.title': '站内通知',
        'tab.notification': '通知',
      })[key] ??
      fallback ??
      key,
  }),
}));

vi.mock('./SubscriptionIframeWrapper', () => ({
  SubscriptionIframeWrapper: ({ page }: { page: string }) => (
    <div data-page={page} data-testid="subscription-iframe-wrapper" />
  ),
}));

describe('Notification', () => {
  beforeEach(() => {
    mockIsDesktop.mockReturnValue(true);
    mockNotificationConfig.mockReturnValue({
      desktopEnabled: true,
      emailEnabled: false,
      inboxEnabled: true,
      system: {
        actionUrl: null as string | null,
        content: '',
        enabled: false,
        title: '',
      },
    });
  });

  it('renders the notification embed page on desktop', () => {
    render(<Notification />);

    expect(screen.getByTestId('subscription-iframe-wrapper')).toHaveAttribute(
      'data-page',
      'notification',
    );
  });

  it('renders managed notification settings and announcement action on web', () => {
    mockIsDesktop.mockReturnValue(false);
    mockNotificationConfig.mockReturnValue({
      desktopEnabled: false,
      emailEnabled: true,
      inboxEnabled: true,
      system: {
        actionUrl: 'https://xuangguo.example.com/status',
        content: '今晚 23:00 进行服务升级。',
        enabled: true,
        title: '系统维护通知',
      },
    });

    render(<Notification />);

    expect(screen.getByRole('heading', { name: '通知' })).toBeInTheDocument();
    expect(screen.getByText('站内通知')).toBeInTheDocument();
    expect(screen.getByText('桌面通知')).toBeInTheDocument();
    expect(screen.getByText('邮件通知')).toBeInTheDocument();
    expect(screen.getByText('系统维护通知')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看详情' })).toHaveAttribute(
      'href',
      'https://xuangguo.example.com/status',
    );
  });
});
