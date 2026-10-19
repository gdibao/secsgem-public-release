const BRAND_NAME = '驰拓 AI 助手';
const SUPPORT_EMAIL = 'wodekefu@gmail.com';

/**
 * Email OTP verification template for mobile
 * Sent to users when they need to verify their email using OTP code
 */
export const getVerificationOTPEmailTemplate = (params: {
  expiresInSeconds: number;
  otp: string;
  userName?: string | null;
}) => {
  const { otp, userName, expiresInSeconds } = params;

  // Format expiration time in a human-readable way
  const expiresInMinutes = expiresInSeconds / 60;
  const expirationText =
    expiresInMinutes >= 1
      ? `${expiresInMinutes} 分钟`
      : `${expiresInSeconds} 秒`;

  return {
    html: `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>邮箱验证码 - ${BRAND_NAME}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5; color: #1a1a1a;">
  <!-- Container -->
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

    <!-- Logo -->
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="display: inline-flex; align-items: center; justify-content: center; background-color: #ffffff; border-radius: 12px; padding: 8px 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
        <span style="font-size: 18px; font-weight: 700; color: #000000; letter-spacing: -0.5px;">${BRAND_NAME}</span>
      </div>
    </div>

    <!-- Card -->
    <div style="background: #ffffff; border-radius: 20px; padding: 40px; box-shadow: 0 8px 30px rgba(0,0,0,0.04); border: 1px solid rgba(0,0,0,0.02);">

      <!-- Header -->
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #111827; font-size: 24px; font-weight: 700; margin: 0 0 12px 0; letter-spacing: -0.5px;">
          验证你的邮箱
        </h1>
        <p style="color: #6b7280; font-size: 16px; margin: 0;">
          请在应用中输入下方验证码完成验证。
        </p>
      </div>

      <!-- Content -->
      <div style="color: #374151; font-size: 16px; line-height: 1.6;">
        ${userName ? `<p style="margin: 0 0 16px 0;">你好，<strong>${userName}</strong>：</p>` : ''}

        <p style="margin: 0 0 24px 0;">
          感谢你注册${BRAND_NAME}。请使用下方验证码完成邮箱验证：
        </p>

        <!-- OTP Code Box -->
        <div style="text-align: center; margin: 36px 0;">
          <div style="display: inline-block; background-color: #000000; padding: 24px 48px; border-radius: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            <div style="font-size: 36px; font-weight: 700; letter-spacing: 12px; color: #ffffff; font-family: 'Courier New', Courier, monospace;">
              ${otp}
            </div>
          </div>
        </div>

        <!-- Expiration Note -->
        <div style="background-color: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #f3f4f6;">
          <p style="color: #6b7280; font-size: 14px; margin: 0; text-align: center;">
            ⏰ 此验证码将在 <strong>${expirationText}</strong> 后失效。
          </p>
        </div>

        <p style="color: #6b7280; font-size: 15px; margin: 0 0 8px 0;">
          如果你没有请求此验证码，请忽略此邮件。
        </p>
      </div>

      <!-- Divider -->
      <div style="border-top: 1px solid #e5e7eb; margin: 32px 0;"></div>

      <!-- Security Note -->
      <div style="text-align: center;">
        <p style="color: #9ca3af; font-size: 13px; margin: 0 0 8px 0;">
          🔒 为保障安全，请勿向任何人透露此验证码。
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 32px;">
      <p style="font-size: 13px; margin: 0 0 8px 0;">
        <a href="mailto:${SUPPORT_EMAIL}" style="color: #6b7280; text-decoration: underline;">联系客服</a>
      </p>
      <p style="color: #a1a1aa; font-size: 13px; margin: 0;">
        © 2026 无锡市驰拓信息科技有限公司
      </p>
    </div>
  </div>
</body>
</html>
    `,
    subject: `邮箱验证码 - ${BRAND_NAME}`,
    text: `你的邮箱验证码是：${otp}\n\n此验证码将在 ${expirationText} 后失效。\n\n如果你没有请求此验证码，请忽略此邮件。\n\n联系客服：${SUPPORT_EMAIL}`,
  };
};
