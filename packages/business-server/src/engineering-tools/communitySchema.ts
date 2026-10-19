import { z } from 'zod';

import { publicHttpsUrl, toolIdSchema } from './schema';

const requiredText = (max: number) => z.string().trim().min(1).max(max);
export const submissionFieldsSchema = z.object({
  category: requiredText(100),
  description: requiredText(4000),
  downloadUrl: publicHttpsUrl.optional(),
  license: requiredText(1000),
  name: requiredText(180),
  officialWebsiteUrl: publicHttpsUrl.optional(),
  pricingType: requiredText(100).optional(),
  productUrl: publicHttpsUrl.optional(),
  purchaseUrl: publicHttpsUrl.optional(),
  runUrl: publicHttpsUrl.optional(),
  section: z.enum(['process', 'automation', 'design']),
  shape: z.enum(['web', 'hybrid', 'windows', 'cross-platform', 'device-web', 'sdk', 'unknown']),
  summary: z.string().trim().max(1200),
  vendorName: requiredText(100).optional(),
  visibility: z.enum(['public', 'workspace']),
});

export const saveMyDraftSchema = submissionFieldsSchema.extend({
  expectedVersion: z.number().int().positive().optional(),
  id: z.string().uuid().optional(),
});
export const submissionRefSchema = z.object({ expectedVersion: z.number().int().positive(), id: z.string().uuid() });
export const reviewSchema = submissionRefSchema.extend({
  decision: z.enum(['publish', 'reject']),
  evidence: z.object({
    checkedAt: z.string().datetime({ offset: true }),
    reference: publicHttpsUrl,
    verifiedUrls: z.array(publicHttpsUrl).max(5),
  }).optional(),
  reason: requiredText(500),
});
export const submissionSchema = submissionFieldsSchema.extend({
  authorId: requiredText(256),
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  parentVersion: z.number().int().positive().nullable(),
  reviewEvidence: z.object({
    checkedAt: z.string().datetime({ offset: true }),
    reference: publicHttpsUrl,
    verifiedUrls: z.array(publicHttpsUrl).max(5),
  }).nullable(),
  reviewReason: z.string().max(500).nullable(),
  reviewerId: z.string().nullable(),
  status: z.enum(['draft', 'submitted', 'rejected', 'published', 'superseded']),
  toolId: toolIdSchema,
  updatedAt: z.string().datetime({ offset: true }),
  version: z.number().int().positive(),
  workspaceId: z.string().nullable(),
});

export const ratingSchema = z.object({
  score: z.number().int().min(1).max(5).nullable(),
  toolId: toolIdSchema,
  userId: requiredText(256),
  version: z.number().int().positive(),
});
export const ratingToolSchema = z.object({ toolId: toolIdSchema });
export const ratingWriteSchema = ratingToolSchema.extend({
  expectedVersion: z.number().int().min(0),
  score: z.number().int().min(1).max(5),
});
export const ratingRemoveSchema = ratingToolSchema.extend({ expectedVersion: z.number().int().positive() });

export type Submission = z.infer<typeof submissionSchema>;
