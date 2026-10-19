import {
  renderModuleAppTemplateString,
  renderModuleAppTemplateValue,
} from '../../runtimeTemplate';
import {
  assertModuleAppWorkflowOutput,
  type ModuleAppWorkflowNodeExecutor,
} from '../executors';

export type ModuleAppWorkflowHttpRequest = (input: {
  body?: string;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  url: string;
}) => Promise<{ body: string; contentType?: string; status: number }>;

const stringConfig = (config: Record<string, unknown>, key: string) => {
  const value = config[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const headersConfig = (config: Record<string, unknown>, input: Record<string, unknown>) => {
  const headers = config.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return undefined;

  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>).map(([key, value]) => {
      if (typeof value !== 'string') throw new Error('MODULE_APP_WORKFLOW_HTTP_NOT_CONFIGURED');
      return [key, renderModuleAppTemplateString(value, input)];
    }),
  );
};

const parseBody = (body: string, contentType?: string): unknown => {
  if (!body) return '';
  if (contentType?.toLowerCase().includes('json')) {
    try {
      return JSON.parse(body);
    } catch {
      throw new Error('MODULE_APP_WORKFLOW_HTTP_RESPONSE_INVALID');
    }
  }
  return body;
};

export const createModuleAppHttpWorkflowExecutor = (options: {
  assertEntitlement: () => Promise<unknown> | unknown;
  request: ModuleAppWorkflowHttpRequest;
}): ModuleAppWorkflowNodeExecutor => async (context) => {
  const configuredUrl = stringConfig(context.node.config, 'url');
  if (!configuredUrl) throw new Error('MODULE_APP_WORKFLOW_HTTP_NOT_CONFIGURED');
  const method = stringConfig(context.node.config, 'method')?.toUpperCase();
  if (method && method !== 'GET' && method !== 'POST') {
    throw new Error('MODULE_APP_WORKFLOW_HTTP_NOT_CONFIGURED');
  }

  await options.assertEntitlement();
  const renderedBody = renderModuleAppTemplateValue(context.node.config.body, context.input);
  const response = await options.request({
    body:
      method === 'POST' && renderedBody !== undefined
        ? JSON.stringify(renderedBody)
        : undefined,
    headers: headersConfig(context.node.config, context.input),
    method: (method as 'GET' | 'POST' | undefined) ?? 'GET',
    url: renderModuleAppTemplateString(configuredUrl, context.input),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`MODULE_APP_WORKFLOW_HTTP_FAILED:${response.status}`);
  }

  return {
    output: assertModuleAppWorkflowOutput({
      body: parseBody(response.body, response.contentType),
      contentType: response.contentType,
      status: response.status,
    }),
  };
};
