import { BRANDING_EMAIL, SOCIAL_URL } from '@lobechat/business-const';

interface EmailSupportCopy {
  contactSupport?: string;
  joinDiscord?: string;
}

const DEFAULT_SUPPORT_COPY = {
  contactSupport: 'Contact support',
  joinDiscord: 'Visit the product website',
} satisfies Required<EmailSupportCopy>;

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const EMAIL_SUPPORT_ADDRESS = BRANDING_EMAIL.support;
export const EMAIL_SUPPORT_REPLY_TO = BRANDING_EMAIL.replyTo;

export const getEmailSupportHtml = ({
  contactSupport = DEFAULT_SUPPORT_COPY.contactSupport,
  joinDiscord = DEFAULT_SUPPORT_COPY.joinDiscord,
}: EmailSupportCopy = {}) => {
  const supportEmail = escapeHtml(EMAIL_SUPPORT_ADDRESS);
  const communityLink = SOCIAL_URL.discord
    ? `<span style="color: #a1a1aa;"> · </span><a href="${escapeHtml(SOCIAL_URL.discord)}" target="_blank" rel="noopener noreferrer" style="color: #6b7280; text-decoration: underline;">${escapeHtml(joinDiscord)}</a>`
    : '';

  return `<a href="mailto:${supportEmail}" style="color: #6b7280; text-decoration: underline;">${escapeHtml(contactSupport)}</a>${communityLink}`;
};

export const getEmailSupportText = ({
  contactSupport = DEFAULT_SUPPORT_COPY.contactSupport,
  joinDiscord = DEFAULT_SUPPORT_COPY.joinDiscord,
}: EmailSupportCopy = {}) =>
  SOCIAL_URL.discord
    ? `${contactSupport}: ${EMAIL_SUPPORT_ADDRESS} | ${joinDiscord}: ${SOCIAL_URL.discord}`
    : `${contactSupport}: ${EMAIL_SUPPORT_ADDRESS}`;
