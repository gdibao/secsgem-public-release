import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  getTestMessageUrl: vi.fn(),
  sendMail: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mocks.createTransport,
    getTestMessageUrl: mocks.getTestMessageUrl,
  },
}));

vi.mock('@/envs/email', () => ({
  emailEnv: {
    SMTP_FROM: 'noreply@example.com',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PASS: 'smtp-password',
    SMTP_PORT: 465,
    SMTP_SECURE: true,
    SMTP_USER: 'smtp-user',
  },
}));

describe('NodemailerImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, verify: mocks.verify });
    mocks.getTestMessageUrl.mockReturnValue(false);
    mocks.sendMail.mockResolvedValue({ messageId: 'message-id' });
  });

  it('maps only the supported email payload fields to Nodemailer', async () => {
    const { NodemailerImpl } = await import('./index');
    const service = new NodemailerImpl();

    await expect(
      service.sendMail({
        attachments: [{ content: 'invoice', filename: 'invoice.txt' }],
        html: '<p>Invoice</p>',
        replyTo: 'support@example.com',
        subject: 'Invoice',
        text: 'Invoice',
        to: 'member@example.com',
      }),
    ).resolves.toEqual({ messageId: 'message-id', previewUrl: undefined });

    expect(mocks.createTransport).toHaveBeenCalledWith({
      auth: { pass: 'smtp-password', user: 'smtp-user' },
      host: 'smtp.example.com',
      port: 465,
      secure: true,
    });

    const message = mocks.sendMail.mock.calls[0]?.[0];
    expect(message).toEqual({
      attachments: [{ content: 'invoice', filename: 'invoice.txt' }],
      from: 'noreply@example.com',
      html: '<p>Invoice</p>',
      replyTo: 'support@example.com',
      subject: 'Invoice',
      text: 'Invoice',
      to: 'member@example.com',
    });
    expect(message).not.toHaveProperty('raw');
  });
});
