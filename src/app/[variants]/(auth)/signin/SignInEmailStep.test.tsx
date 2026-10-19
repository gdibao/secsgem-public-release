import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SignInEmailStep } from './SignInEmailStep';

const mocks = vi.hoisted(() => ({
  brand: {
    authTitle: 'Admin auth title',
    name: 'ComHub Runtime',
  },
  form: {
    submit: vi.fn(),
  },
}));

vi.mock('@lobechat/business-const', () => ({
  BRANDING_NAME: 'LobeHub',
}));

vi.mock('@/features/Brand', () => ({
  useBrand: () => mocks.brand,
}));

vi.mock('react-i18next', () => ({
  Trans: () => <span>agreement</span>,
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (key === 'signin.subtitle') return `Sign in to ${options?.appName}`;
      if (key === 'betterAuth.signin.emailPlaceholder') return 'Email';
      return key;
    },
  }),
}));

vi.mock('@/components/AuthIcons', () => ({
  default: () => null,
}));

vi.mock('antd', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const Form = ({ children }: { children: React.ReactNode }) => <form>{children}</form>;
  Form.Item = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;

  return {
    ...actual,
    Badge: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Divider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Form,
  };
});

describe('SignInEmailStep', () => {
  it('uses the admin-configured name without replacing the upstream sign-in hierarchy', () => {
    render(
      <SignInEmailStep
        serverConfigInit
        disableEmailPassword={false}
        form={mocks.form as any}
        isSocialOnly={false}
        loading={false}
        oAuthSSOProviders={[]}
        socialLoading={null}
        onCheckUser={vi.fn()}
        onGoToSignup={vi.fn()}
        onResetEmail={vi.fn()}
        onSetPassword={vi.fn()}
        onSocialSignIn={vi.fn()}
      />,
    );

    expect(screen.getByText('Sign in to ComHub Runtime')).toBeInTheDocument();
    expect(screen.queryByText('Admin auth title')).not.toBeInTheDocument();
    expect(screen.queryByText('Sign in to LobeHub')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'betterAuth.signin.nextStep' })).toBeInTheDocument();
  });
});
