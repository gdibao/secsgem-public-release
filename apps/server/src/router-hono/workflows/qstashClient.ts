import { OtelQstashClient } from '@/libs/qstash';
import type { Context } from 'hono';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

export const isWorkflowQstashAvailable = () => Boolean(process.env.QSTASH_TOKEN?.trim());

// NOTICE(@nekomeowww): Scenarios like Vercel Deployment Protection require custom headers on
// intermediate `context.run(...)` calls (which don't accept per-call headers). We inject them via
// a shared QStash client. See:
// https://upstash.com/docs/workflow/troubleshooting/vercel#step-2-pass-header-when-triggering
export const createWorkflowQstashClient = () => {
  const token = process.env.QSTASH_TOKEN?.trim();

  if (!token) return undefined;

  return new OtelQstashClient({
    headers: { ...upstashWorkflowExtraHeaders },
    token,
  });
};

export const workflowUnavailableResponse = () => (c: Context) =>
  c.json(
    {
      error: 'workflow_unavailable',
      message: 'QSTASH_TOKEN is required to run this workflow endpoint.',
    },
    503,
  );

export { upstashWorkflowExtraHeaders };
