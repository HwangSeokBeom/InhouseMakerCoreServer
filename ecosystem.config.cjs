module.exports = {
  apps: [
    {
      name: 'inhouse-maker-server-staging',
      cwd: __dirname,
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
        APP_ENV: 'staging',
      },
    },
    {
      name: 'inhouse-maker-server-production',
      cwd: __dirname,
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
        APP_ENV: 'production',
      },
    },
  ],
};
