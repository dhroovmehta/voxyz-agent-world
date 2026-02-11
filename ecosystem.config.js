// ecosystem.config.js — PM2 process configuration
// WHY: Three-process model. Each process has a single job.
// Run: pm2 start ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'discord_bot',
      script: 'src/discord_bot.js',
      cwd: __dirname,
      watch: false,
      max_memory_restart: '300M', // 1GB VPS, leave room for others
      env: {
        NODE_ENV: 'production'
      },
      // Auto-restart on crash, max 5 restarts in 5 minutes
      max_restarts: 5,
      min_uptime: '10s',
      restart_delay: 5000
    },
    {
      name: 'heartbeat',
      script: 'src/heartbeat.js',
      cwd: __dirname,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production'
      },
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000
    },
    {
      name: 'worker',
      script: 'src/worker.js',
      cwd: __dirname,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production'
      },
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000
    }
  ]
};
