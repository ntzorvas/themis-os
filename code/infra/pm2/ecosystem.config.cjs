// PM2 Ecosystem Configuration — ΘΕΜΙΣ OS
// Αναφορά: docs/v03/tech-stack-v03.md §10
// Χρήση: pm2 start infra/pm2/ecosystem.config.cjs --env production

const path = require('path');

// Βασικός φάκελος του project
const APP_ROOT = path.resolve(__dirname, '../..');

module.exports = {
  apps: [
    // ============================================================
    // themisos-web — Next.js frontend
    // ============================================================
    {
      name: 'themisos-web',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: path.join(APP_ROOT, 'apps/web'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
        WEB_PORT: '3110',
      },
      env_production: {
        NODE_ENV: 'production',
        WEB_PORT: '3110',
      },
      error_file: '/var/log/pm2/themisos-web-error.log',
      out_file:   '/var/log/pm2/themisos-web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ============================================================
    // themisos-api — Fastify backend
    // ============================================================
    {
      name: 'themisos-api',
      script: 'dist/server.js',
      cwd: path.join(APP_ROOT, 'apps/api'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
        API_PORT: '4000',
        LOG_LEVEL: 'info',
      },
      env_production: {
        NODE_ENV: 'production',
        API_PORT: '4000',
        LOG_LEVEL: 'warn',
      },
      error_file: '/var/log/pm2/themisos-api-error.log',
      out_file:   '/var/log/pm2/themisos-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ============================================================
    // themisos-worker — BullMQ workers (8 queues Phase 1)
    // Αναφορά: docs/v03/api-architecture-v03.md §D-API-17
    // Queues: document-processing, aegis-anagnostis, aegis-prothesmias,
    //         aegis-erevnitikos, aegis-syngrammatos, mydata-submit,
    //         notifications-email, kms-rotation
    // ============================================================
    {
      name: 'themisos-worker',
      script: 'dist/worker.js',
      // TODO: worker.ts υλοποιείται Day 7 (document processing)
      cwd: path.join(APP_ROOT, 'apps/api'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'info',
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'warn',
      },
      error_file: '/var/log/pm2/themisos-worker-error.log',
      out_file:   '/var/log/pm2/themisos-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // Worker εκκινεί μόνο αν υπάρχει το dist/worker.js
      // Αφαιρέστε αυτό μόλις υλοποιηθεί:
      autorestart: false,
    },
  ],
};
