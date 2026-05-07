// PM2 Ecosystem — ΘΕΜΙΣ OS Preview
// Server: 89.167.110.132
// Domain: themis.mentorist.gr

module.exports = {
  apps: [
    {
      name: 'themis-api',
      script: '/opt/themis-os/apps/api/dist/server.js',
      cwd: '/opt/themis-os/apps/api',
      env_file: '/opt/themis-os/.env.preview',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: '/var/log/pm2/themis-api-out.log',
      error_file: '/var/log/pm2/themis-api-err.log',
    },
    {
      name: 'themis-web',
      script: 'node_modules/.bin/next',
      args: 'start --port 3501',
      cwd: '/opt/themis-os/apps/web',
      env_file: '/opt/themis-os/.env.preview',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: '/var/log/pm2/themis-web-out.log',
      error_file: '/var/log/pm2/themis-web-err.log',
    },
  ],
};
