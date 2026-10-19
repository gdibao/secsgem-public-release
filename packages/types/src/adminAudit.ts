import { z } from 'zod';

export const auditEnvelopeStatusSchema = z.enum(['failed', 'started', 'succeeded']);
export type AuditEnvelopeStatus = z.infer<typeof auditEnvelopeStatusSchema>;

export const auditEnvelopeSchema = z
  .object({
    action: z.string().min(1),
    actorUserId: z.string().nullable(),
    clientIp: z.string().nullable(),
    correlationId: z.string().min(1),
    resourceId: z.string().nullable(),
    resourceType: z.string().nullable(),
    status: auditEnvelopeStatusSchema,
    targetUserId: z.string().nullable(),
  })
  .strict();
export type AuditEnvelope = z.infer<typeof auditEnvelopeSchema>;

const SENSITIVE_AUDIT_FIELD = /authorization|certificate|cookie|key|password|secret|token/i;
const REDACTED_VALUE = '[REDACTED]';

export const redactAuditValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_AUDIT_FIELD.test(key) ? REDACTED_VALUE : redactAuditValue(nestedValue),
    ]),
  );
};

export const createAuditEnvelope = (params: {
  audit: AuditEnvelope;
  payload?: null | Record<string, unknown>;
}): Record<string, unknown> => ({
  ...(redactAuditValue(params.payload ?? {}) as Record<string, unknown>),
  audit: params.audit,
});

export const readAuditEnvelope = (value: unknown): AuditEnvelope | undefined => {
  if (!value || typeof value !== 'object') return undefined;

  const audit = (value as { audit?: unknown }).audit;
  const parsed = auditEnvelopeSchema.safeParse(audit);

  return parsed.success ? parsed.data : undefined;
};
