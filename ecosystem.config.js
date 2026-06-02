/**
 * PM2 ecosystem configuration for Taproot POS API.
 *
 * Usage:
 *   pm2 start ecosystem.config.js --env staging
 *   pm2 start ecosystem.config.js --env production
 *   pm2 restart taproot-api --env production
 *   pm2 logs taproot-api
 */

'use strict';

module.exports = {
  apps: [
    {
      name:   'taproot-api',
      script: 'apps/api/dist/index.js',

      // Cluster mode: one process per CPU core for maximum throughput.
      // Node.js is single-threaded; cluster lets us use all cores.
      instances: 'max',
      exec_mode: 'cluster',

      // Never watch for file changes in production — use rolling deploys instead
      watch: false,

      // Restart automatically if memory exceeds 1 GB (memory leak guard)
      max_memory_restart: '1G',

      // Minimum 100ms between restarts to prevent restart storms
      min_uptime:      '5s',
      max_restarts:    10,
      restart_delay:   2000,

      // Log files (relative to project root)
      error_file:      'logs/api-error.log',
      out_file:        'logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs:      true,

      // Graceful shutdown: wait up to 5 seconds for in-flight requests
      kill_timeout: 5000,

      // Environment: staging
      env_staging: {
        NODE_ENV: 'staging',
        PORT:     3001,
      },

      // Environment: production
      env_production: {
        NODE_ENV: 'production',
        PORT:     3001,
      },
    },
  ],
};
