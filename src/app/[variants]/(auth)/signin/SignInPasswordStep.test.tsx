import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SignInPasswordStep } from './SignInPasswordStep';

const mocks = vi.hoisted(() => ({
  form: {
    submit: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === 'betterAuth.signin.passwordStep.title' ? 'Enter your password' : key,
  }),
}));

vi.mock('antd', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const Form = ({ children }: { children: React.ReactNode }) => <form>{children}</form>;
  Form.Item = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;

  return {
    ...actual,
    Form,
  };
});

describe('SignInPasswordStep', () => {
  it('uses the upstream password title and the account email as subtitle', () => {
    render(
      <SignInPasswordStep
        email="user@example.com"
        forgotLoading={false}
        form={mocks.form as any}
        loading={false}
        onBackToEmail={vi.fn()}
        onForgotPassword={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
  });
});
