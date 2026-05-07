import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import tenantPlugin from './plugins/fastify-tenant.js';
import authRoutes from './routes/auth/index.js';
import partiesRoutes from './routes/parties/index.js';
import mattersRoutes from './routes/matters/index.js';
import documentsRoutes from './routes/documents/index.js';
import calendarRoutes from './routes/calendar/index.js';
import timeEntriesRoutes from './routes/time-entries/index.js';
import expensesRoutes from './routes/expenses/index.js';
import invoicesRoutes from './routes/invoices/index.js';
import reportsRoutes from './routes/reports/index.js';

// Λήψη ρυθμίσεων από μεταβλητές περιβάλλοντος
const PORT = parseInt(process.env['API_PORT'] ?? '4000', 10);
const HOST = process.env['API_HOST'] ?? '0.0.0.0';
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
const LOG_LEVEL = process.env['LOG_LEVEL'] ?? 'info';

// Δημιουργία Fastify instance με Pino logger
const app = Fastify({
  logger: {
    level: LOG_LEVEL,
    // Prettified output μόνο σε development
    ...(NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l' },
          },
        }
      : {}),
  },
});

// ============================================================
// PLUGINS
// ============================================================

// CORS — Next.js frontend επικοινωνία
await app.register(cors, {
  origin:
    NODE_ENV === 'development'
      ? true
      : [
          `https://${process.env['PRODUCT_DOMAIN'] ?? 'themisos.gr'}`,
          /\.themisos\.gr$/,
        ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

// Helmet — security headers
await app.register(helmet, {
  contentSecurityPolicy: NODE_ENV === 'production',
});

// JWT — must be registered before the tenant plugin
await app.register(jwt, {
  secret: process.env['JWT_SECRET'] ?? (() => { throw new Error('JWT_SECRET δεν έχει οριστεί.'); })(),
});

// Rate limiting — global default (per-tier override στο auth middleware Day 4)
await app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
  errorResponseBuilder: (_request, context) => ({
    code: 'RATE_LIMIT_EXCEEDED',
    message: `Υπέρβαση ορίου αιτημάτων. Δοκιμάστε πάλι σε ${String(context.after)}.`,
    details: null,
    trace_id: null,
  }),
});

// Multipart — for document uploads (registered before tenant + routes)
await app.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
    files: 1,
    fields: 10,
  },
});

// Tenant resolution — after cors, helmet, jwt
await app.register(tenantPlugin);

// Auth routes — registered after tenant plugin; individual routes are exempt
// as listed in fastify-tenant.ts EXEMPT_ROUTES
await app.register(authRoutes);

// Parties routes — Unified Party Model (Invariant #1)
await app.register(partiesRoutes);

// Matters routes — Matter ↔ Party M2M (Invariant #2)
await app.register(mattersRoutes);

// Documents routes — upload, encrypt, version, stream (Invariant #9)
await app.register(documentsRoutes);

// Calendar routes — deadline rules engine + calendar events (Day 8)
await app.register(calendarRoutes);

// Time Entries routes — billable time tracking (Day 9)
await app.register(timeEntriesRoutes);

// Expenses routes — disbursements per matter (Day 9)
await app.register(expensesRoutes);

// Invoices routes — billing engine with billing_split support (Day 9)
await app.register(invoicesRoutes);

// Reports routes — billing summary, time-by-user, realization-rate (Day 9)
await app.register(reportsRoutes);

// ============================================================
// ROUTES
// ============================================================

// Health check — χρησιμοποιείται από nginx, PM2, synthetic monitoring
app.get('/health', {
  schema: {
    description: 'Health check endpoint',
    tags: ['system'],
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          service: { type: 'string' },
          version: { type: 'string' },
          ts: { type: 'string' },
        },
      },
    },
  },
  handler: async (_request, reply) => {
    return reply.code(200).send({
      status: 'ok',
      service: `${process.env['PRODUCT_SLUG'] ?? 'themisos'}-api`,
      version: '0.1.0',
      ts: new Date().toISOString(),
    });
  },
});

// Placeholder για API v1 — συμπληρώνεται Day 2+
app.get('/api/v1', async (_request, reply) => {
  return reply.code(200).send({
    api: `${process.env['PRODUCT_SLUG'] ?? 'themisos'}-api`,
    version: 'v1',
    status: 'under_construction',
    docs: '/api/v1/docs',
  });
});

// 404 handler — standardized error envelope (D-API-10)
app.setNotFoundHandler(async (_request, reply) => {
  return reply.code(404).send({
    code: 'NOT_FOUND',
    message: 'Το endpoint δεν βρέθηκε.',
    details: null,
    trace_id: null,
  });
});

// Global error handler
app.setErrorHandler<FastifyError>(async (error, _request, reply) => {
  app.log.error(error);
  const statusCode = error.statusCode ?? 500;
  return reply.code(statusCode).send({
    code: error.code ?? 'INTERNAL_ERROR',
    message:
      NODE_ENV === 'production'
        ? 'Εσωτερικό σφάλμα διακομιστή.'
        : (error.message ?? 'Unknown error'),
    details: null,
    trace_id: null,
  });
});

// ============================================================
// STARTUP
// ============================================================

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(
    `${process.env['PRODUCT_SLUG'] ?? 'themisos'}-api ακούει στο http://${HOST}:${String(PORT)}`
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
