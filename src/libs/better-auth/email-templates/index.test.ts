import { describe, expect, it } from 'vitest';

import {
  getChangeEmailVerificationTemplate,
  getMagicLinkEmailTemplate,
  getResetPasswordEmailTemplate,
  getVerificationEmailTemplate,
  getVerificationOTPEmailTemplate,
  getWorkspaceInviteEmailTemplate,
  getWorkspaceMemberRemovedEmailTemplate,
} from './index';

const templates = [
  getChangeEmailVerificationTemplate({
    expiresInSeconds: 3600,
    url: 'https://example.com/change-email',
  }),
  getMagicLinkEmailTemplate({
    expiresInSeconds: 600,
    url: 'https://example.com/sign-in',
  }),
  getResetPasswordEmailTemplate({ url: 'https://example.com/reset-password' }),
  getWorkspaceInviteEmailTemplate({
    expiresInDays: 7,
    role: 'member',
    url: 'https://example.com/invite',
    workspaceName: 'Example Workspace',
  }),
  getWorkspaceMemberRemovedEmailTemplate({
    reason: 'removed_by_owner',
    workspaceName: 'Example Workspace',
  }),
];

const verificationTemplate = getVerificationEmailTemplate({
  expiresInSeconds: 3600,
  url: 'https://fab.secsgem.com.cn/verify-email?token=redacted&callbackURL=%2Fsignin',
});

const verificationOtpTemplate = getVerificationOTPEmailTemplate({
  expiresInSeconds: 600,
  otp: '123456',
});

describe('email templates', () => {
  it.each(templates)(
    'includes support email and Discord links in HTML and plain text',
    (template) => {
      expect(template.html).toContain('href="mailto:support@lobehub.com"');
      expect(template.html).toContain('https://discord.gg/');
      expect(template.text).toContain('support@lobehub.com');
      expect(template.text).toContain('https://discord.gg/');
    },
  );

  it('renders Chituo verification mail in simplified Chinese without legacy branding', () => {
    for (const template of [verificationTemplate, verificationOtpTemplate]) {
      expect(template.subject).toContain('驰拓 AI 助手');
      expect(template.html).toContain('驰拓 AI 助手');
      expect(template.html).not.toMatch(/LobeHub|Lobe|玄果/);
      expect(template.text).not.toMatch(/LobeHub|Lobe|玄果/);
    }

    expect(verificationTemplate.subject).toBe('验证你的邮箱 - 驰拓 AI 助手');
    expect(verificationTemplate.html).toContain('此链接将在 <strong>1 小时</strong> 后失效');
    expect(verificationTemplate.html).toContain('验证邮箱');
    expect(verificationTemplate.html).toContain('wodekefu@gmail.com');
    expect(verificationTemplate.text).toContain('https://fab.secsgem.com.cn/verify-email?token=redacted');
    expect(verificationOtpTemplate.html).toContain('wodekefu@gmail.com');
  });
});
