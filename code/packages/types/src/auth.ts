import { z } from 'zod';
import { FirmRoleSchema, SubscriptionTierSchema } from './firm';

// JWT payload — D-API-6
// Το token περιέχει firm context για tenant resolution
export const JwtPayloadSchema = z.object({
  sub: z.string().uuid(),       // user_id
  firm: z.string().uuid(),      // firm_id
  firm_slug: z.string(),        // για subdomain resolution
  tier: SubscriptionTierSchema,
  role: FirmRoleSchema,
  iat: z.number(),
  exp: z.number(),
});

export type JwtPayload = z.infer<typeof JwtPayloadSchema>;

// Login request
export const LoginRequestSchema = z.object({
  email: z.string().email('Μη έγκυρη διεύθυνση email'),
  password: z.string().min(8, 'Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες'),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// Login response
export const LoginResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number(), // seconds
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
