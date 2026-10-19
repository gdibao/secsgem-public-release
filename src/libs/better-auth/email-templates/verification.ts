const BRAND_NAME = '驰拓 AI 助手';
const BRAND_LOGO_URL = 'https://fab.secsgem.com.cn/images/brand/chituo-ai-logo.png';
const SUPPORT_EMAIL = 'wodekefu@gmail.com';

/**
 * Email verification template
 * Sent to users when they sign up to verify their email address
 */
export const getVerificationEmailTemplate = (params: {
  expiresInSeconds: number;
  url: string;
  userName?: string | null;
}) => {
  const { url, userName, expiresInSeconds } = params;

  // Format expiration time in a human-readable way
  const expiresInHours = expiresInSeconds / 3600;
  const expirationText =
    expiresInHours >= 1
      ? `${expiresInHours} 小时`
      : `${expiresInSeconds / 60} 分钟`;

  return {
    html: `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>验证邮箱 - ${BRAND_NAME}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5; color: #1a1a1a;">
  <!-- Container -->
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    
    <!-- Logo -->
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="display: inline-flex; align-items: center; justify-content: center; background-color: #ffffff; border-radius: 12px; padding: 8px 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
        <img src="${BRAND_LOGO_URL}" alt="${BRAND_NAME}" width="32" height="32" style="display: block; margin-right: 10px; border-radius: 8px;">
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
          完成邮箱验证后即可登录${BRAND_NAME}。
        </p>
      </div>

      <!-- Content -->
      <div style="color: #374151; font-size: 16px; line-height: 1.6;">
        ${userName ? `<p style="margin: 0 0 16px 0;">你好，<strong>${userName}</strong>：</p>` : ''}
        
        <p style="margin: 0 0 24px 0;">
          感谢你注册${BRAND_NAME}。请点击下方按钮验证邮箱，完成后即可进入你的账号。
        </p>

        <!-- Button -->
        <div style="text-align: center; margin: 36px 0;">
          <a href="${url}" target="_blank"
             style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 16px 36px; border-radius: 14px; font-weight: 600; font-size: 16px; transition: transform 0.1s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            验证邮箱
          </a>
        </div>

        <!-- Expiration Note -->
        <div style="background-color: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #f3f4f6;">
          <p style="color: #6b7280; font-size: 14px; margin: 0; text-align: center;">
            ⏰ 此链接将在 <strong>${expirationText}</strong> 后失效。
          </p>
        </div>
        
        <p style="color: #6b7280; font-size: 15px; margin: 0 0 8px 0;">
          如果你没有注册${BRAND_NAME}，请忽略此邮件。
        </p>
      </div>

      <!-- Divider -->
      <div style="border-top: 1px solid #e5e7eb; margin: 32px 0;"></div>

      <!-- Fallback Link -->
      <div style="text-align: center;">
        <p style="color: #9ca3af; font-size: 13px; margin: 0 0 8px 0;">
          如果按钮无法打开，请复制以下链接到浏览器中访问：
        </p>
        <a href="${url}" style="color: #2563eb; font-size: 13px; text-decoration: none; word-break: break-all; display: block; line-height: 1.4;">
          ${url}
        </a>
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
    subject: `验证你的邮箱 - ${BRAND_NAME}`,
    text: `请点击此链接验证你的邮箱：${url}\n\n此链接将在 ${expirationText} 后失效。\n\n联系客服：${SUPPORT_EMAIL}`,
  };
};
