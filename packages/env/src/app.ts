import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const isInVercel = process.env.VERCEL === '1';

// Vercel URL fallback order (by stability):
// 1. VERCEL_PROJECT_PRODUCTION_URL - project level, most stable
// 2. VERCEL_URL - deployment level, changes every deployment
// 3. VERCEL_BRANCH_URL - branch level, stable across deployments on same branch
const getVercelUrl = () => {
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `https://${process.env.VERCEL_BRANCH_URL}`;
};

const APP_URL =
  process.env.APP_URL ||
  (isInVercel
    ? getVercelUrl()
    : process.env.NODE_ENV === 'development'
      ? `http://localhost:${process.env.PORT || 3010}`
      : `http://localhost:${process.env.PORT || 3210}`);

// INTERNAL_APP_URL is used for server-to-server calls to bypass CDN/proxy
// Falls back to APP_URL if not set
const INTERNAL_APP_URL = process.env.INTERNAL_APP_URL || APP_URL;

const MODULE_APP_ALIPAY_MODE =
  process.env.MODULE_APP_ALIPAY_MODE === 'production' ? 'production' : 'sandbox';
const MODULE_APP_ALIPAY_GATEWAY =
  process.env.MODULE_APP_ALIPAY_GATEWAY ||
  (MODULE_APP_ALIPAY_MODE === 'production'
    ? 'https://openapi.alipay.com/gateway.do'
    : 'https://openapi-sandbox.dl.alipaydev.com/gateway.do');

const parseModuleAppAllowlist = (value?: string) =>
  Array.from(
    new Set(
      (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 160),
    ),
  ).slice(0, 500);

const ASSISTANT_INDEX_URL = 'https://registry.npmmirror.com/@lobehub/agents-index/v1/files/public';

const PLUGINS_INDEX_URL = 'https://registry.npmmirror.com/@lobehub/plugins-index/v1/files/public';

export const getAppConfig = () => {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    client: {
      NEXT_PUBLIC_ENABLE_SENTRY: z.boolean(),
    },
    server: {
      AGENTS_INDEX_URL: z.string().url(),

      DEFAULT_AGENT_CONFIG: z.string(),
      SYSTEM_AGENT: z.string().optional(),

      PLUGINS_INDEX_URL: z.string().url(),
      PLUGIN_SETTINGS: z.string().optional(),

      APP_URL: z.string(),
      INTERNAL_APP_URL: z.string().optional(),
      VERCEL_EDGE_CONFIG: z.string().optional(),
      MIDDLEWARE_REWRITE_THROUGH_LOCAL: z.boolean().optional(),

      CDN_USE_GLOBAL: z.boolean().optional(),
      CUSTOM_FONT_FAMILY: z.string().optional(),
      CUSTOM_FONT_URL: z.string().optional(),

      SSRF_ALLOW_PRIVATE_IP_ADDRESS: z.boolean().optional(),
      SSRF_ALLOW_IP_ADDRESS_LIST: z.string().optional(),

      MARKET_BASE_URL: z.string().optional(),
      /**
       * Trusted Client Secret for Market API authentication
       * 64-character hex string (32 bytes) shared with Market server
       * Used to encrypt user payload for trusted client authentication
       * Generate with: openssl rand -hex 32
       */
      MARKET_TRUSTED_CLIENT_SECRET: z.string().length(83).optional(),
      /**
       * Trusted Client ID for Market API authentication
       * Must be registered in Market's TRUSTED_CLIENT_IDS whitelist
       * e.g., "lobechat-com", "lobehub-desktop"
       */
      MARKET_TRUSTED_CLIENT_ID: z.string().optional(),

      MODULE_APP_EXECUTION_ENABLED: z.boolean().optional(),
      MODULE_APP_RUNTIME_PUBLIC_ORIGIN: z.string().url().optional(),
      MODULE_APP_RUNTIME_INVOCATION_ENABLED: z.boolean(),
      MODULE_APP_WORKFLOW_PRIVILEGED_EXECUTORS_ENABLED: z.boolean(),
      MODULE_APP_SCHEDULE_DISPATCH_ENABLED: z.boolean(),
      MODULE_APP_ALIPAY_PAYMENT_CREATION_ENABLED: z.boolean(),
      MODULE_APP_ALIPAY_AUTO_SETTLEMENT_ENABLED: z.boolean(),
      MODULE_APP_PUBLISHER_PAYOUT_RECORDING_ENABLED: z.boolean(),
      MODULE_APP_PUBLIC_EXECUTION_ENABLED: z.boolean(),
      MODULE_APP_RUNTIME_APP_ALLOWLIST: z.string().optional().transform(parseModuleAppAllowlist),
      MODULE_APP_PUBLISHER_ALLOWLIST: z.string().optional().transform(parseModuleAppAllowlist),
      MODULE_APP_ALIPAY_APP_ID: z.string().optional(),
      MODULE_APP_ALIPAY_APP_CERT_SN: z.string().optional(),
      MODULE_APP_ALIPAY_CERTIFICATE: z.string().optional(),
      MODULE_APP_ALIPAY_CERT_MODE: z.enum(['certificate', 'public_key']).optional(),
      MODULE_APP_ALIPAY_ENABLED: z.boolean(),
      MODULE_APP_ALIPAY_GATEWAY: z.string().url(),
      MODULE_APP_ALIPAY_MERCHANT_PRIVATE_KEY: z.string().optional(),
      MODULE_APP_ALIPAY_MODE: z.enum(['production', 'sandbox']),
      MODULE_APP_ALIPAY_NOTIFY_URL: z.string().url().optional(),
      MODULE_APP_ALIPAY_PUBLIC_KEY: z.string().optional(),
      MODULE_APP_ALIPAY_RETURN_URL: z.string().url().optional(),
      MODULE_APP_ALIPAY_ROOT_CERT_SN: z.string().optional(),
      MODULE_APP_ALIPAY_SELLER_ID: z.string().optional(),

      AGENT_GATEWAY_SERVICE_TOKEN: z.string().optional(),
      ENABLE_AGENT_GATEWAY: z.boolean().optional(),
      /**
       * Server-to-server Agent Gateway endpoint, e.g. a Docker Compose service
       * name the browser cannot resolve. Falls back to AGENT_GATEWAY_URL.
       */
      AGENT_GATEWAY_INTERNAL_URL: z.string().url().optional(),
      AGENT_GATEWAY_URL: z.string().url().optional(),
      /**
       * Enable Queue-based Agent Runtime
       * When true, use QStash for async agent execution (production)
       * When false, execute agent steps synchronously in current process (development)
       * @default false
       */
      enableQueueAgentRuntime: z.boolean().optional(),
      TELEMETRY_DISABLED: z.boolean().optional(),
    },
    runtimeEnv: {
      // Sentry
      NEXT_PUBLIC_ENABLE_SENTRY: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

      AGENTS_INDEX_URL: !!process.env.AGENTS_INDEX_URL
        ? process.env.AGENTS_INDEX_URL
        : ASSISTANT_INDEX_URL,

      DEFAULT_AGENT_CONFIG: process.env.DEFAULT_AGENT_CONFIG || '',
      SYSTEM_AGENT: process.env.SYSTEM_AGENT,

      PLUGINS_INDEX_URL: !!process.env.PLUGINS_INDEX_URL
        ? process.env.PLUGINS_INDEX_URL
        : PLUGINS_INDEX_URL,

      PLUGIN_SETTINGS: process.env.PLUGIN_SETTINGS,

      VERCEL_EDGE_CONFIG: process.env.VERCEL_EDGE_CONFIG,

      APP_URL,
      INTERNAL_APP_URL,
      MIDDLEWARE_REWRITE_THROUGH_LOCAL: process.env.MIDDLEWARE_REWRITE_THROUGH_LOCAL === '1',

      CUSTOM_FONT_FAMILY: process.env.CUSTOM_FONT_FAMILY,
      CUSTOM_FONT_URL: process.env.CUSTOM_FONT_URL,
      CDN_USE_GLOBAL: process.env.CDN_USE_GLOBAL === '1',

      SSRF_ALLOW_PRIVATE_IP_ADDRESS: process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS === '1',
      SSRF_ALLOW_IP_ADDRESS_LIST: process.env.SSRF_ALLOW_IP_ADDRESS_LIST,
      MARKET_BASE_URL: process.env.MARKET_BASE_URL,

      MARKET_TRUSTED_CLIENT_SECRET: process.env.MARKET_TRUSTED_CLIENT_SECRET,
      MARKET_TRUSTED_CLIENT_ID: process.env.MARKET_TRUSTED_CLIENT_ID,

      MODULE_APP_EXECUTION_ENABLED: process.env.MODULE_APP_EXECUTION_ENABLED === 'true',
      MODULE_APP_RUNTIME_PUBLIC_ORIGIN: process.env.MODULE_APP_RUNTIME_PUBLIC_ORIGIN,
      MODULE_APP_RUNTIME_INVOCATION_ENABLED:
        process.env.MODULE_APP_RUNTIME_INVOCATION_ENABLED === 'true',
      MODULE_APP_WORKFLOW_PRIVILEGED_EXECUTORS_ENABLED:
        process.env.MODULE_APP_WORKFLOW_PRIVILEGED_EXECUTORS_ENABLED === 'true',
      MODULE_APP_SCHEDULE_DISPATCH_ENABLED:
        process.env.MODULE_APP_SCHEDULE_DISPATCH_ENABLED === 'true',
      MODULE_APP_ALIPAY_PAYMENT_CREATION_ENABLED:
        process.env.MODULE_APP_ALIPAY_PAYMENT_CREATION_ENABLED === 'true',
      MODULE_APP_ALIPAY_AUTO_SETTLEMENT_ENABLED:
        process.env.MODULE_APP_ALIPAY_AUTO_SETTLEMENT_ENABLED === 'true',
      MODULE_APP_PUBLISHER_PAYOUT_RECORDING_ENABLED:
        process.env.MODULE_APP_PUBLISHER_PAYOUT_RECORDING_ENABLED === 'true',
      MODULE_APP_PUBLIC_EXECUTION_ENABLED:
        process.env.MODULE_APP_PUBLIC_EXECUTION_ENABLED === 'true',
      MODULE_APP_RUNTIME_APP_ALLOWLIST: process.env.MODULE_APP_RUNTIME_APP_ALLOWLIST,
      MODULE_APP_PUBLISHER_ALLOWLIST: process.env.MODULE_APP_PUBLISHER_ALLOWLIST,
      MODULE_APP_ALIPAY_APP_ID: process.env.MODULE_APP_ALIPAY_APP_ID,
      MODULE_APP_ALIPAY_APP_CERT_SN: process.env.MODULE_APP_ALIPAY_APP_CERT_SN,
      MODULE_APP_ALIPAY_CERTIFICATE: process.env.MODULE_APP_ALIPAY_CERTIFICATE,
      MODULE_APP_ALIPAY_CERT_MODE:
        process.env.MODULE_APP_ALIPAY_CERT_MODE === 'certificate' ? 'certificate' : 'public_key',
      MODULE_APP_ALIPAY_ENABLED: process.env.MODULE_APP_ALIPAY_ENABLED === 'true',
      MODULE_APP_ALIPAY_GATEWAY,
      MODULE_APP_ALIPAY_MERCHANT_PRIVATE_KEY: process.env.MODULE_APP_ALIPAY_MERCHANT_PRIVATE_KEY,
      MODULE_APP_ALIPAY_MODE,
      MODULE_APP_ALIPAY_NOTIFY_URL: process.env.MODULE_APP_ALIPAY_NOTIFY_URL,
      MODULE_APP_ALIPAY_PUBLIC_KEY: process.env.MODULE_APP_ALIPAY_PUBLIC_KEY,
      MODULE_APP_ALIPAY_RETURN_URL: process.env.MODULE_APP_ALIPAY_RETURN_URL,
      MODULE_APP_ALIPAY_ROOT_CERT_SN: process.env.MODULE_APP_ALIPAY_ROOT_CERT_SN,
      MODULE_APP_ALIPAY_SELLER_ID: process.env.MODULE_APP_ALIPAY_SELLER_ID,

      AGENT_GATEWAY_SERVICE_TOKEN: process.env.AGENT_GATEWAY_SERVICE_TOKEN,
      ENABLE_AGENT_GATEWAY: process.env.ENABLE_AGENT_GATEWAY === '1',
      AGENT_GATEWAY_URL: process.env.AGENT_GATEWAY_URL,
      AGENT_GATEWAY_INTERNAL_URL: process.env.AGENT_GATEWAY_INTERNAL_URL || undefined,
      enableQueueAgentRuntime: process.env.AGENT_RUNTIME_MODE === 'queue',
      TELEMETRY_DISABLED: process.env.TELEMETRY_DISABLED === '1',
    },
  });
};

export const appEnv = getAppConfig();
