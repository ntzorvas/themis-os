import { z } from 'zod';

// Standardized error envelope — D-API-10
// Κάθε error response από το API ακολουθεί αυτό το schema
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().nullable(),
  trace_id: z.string().nullable(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

// Standardized success envelope με pagination
export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    meta: z
      .object({
        total: z.number().int().optional(),
        page: z.number().int().optional(),
        per_page: z.number().int().optional(),
      })
      .optional(),
  });

// Health check response
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  ts: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
