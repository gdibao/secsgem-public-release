import { z } from 'zod';

export const moduleAppPublisherStatusSchema = z.enum(['pending', 'verified', 'suspended']);
export type ModuleAppPublisherStatus = z.infer<typeof moduleAppPublisherStatusSchema>;

export const moduleAppPayoutStatusSchema = z.enum([
  'pending',
  'eligible',
  'processing',
  'paid',
  'failed',
  'reversed',
]);
export type ModuleAppPayoutStatus = z.infer<typeof moduleAppPayoutStatusSchema>;
