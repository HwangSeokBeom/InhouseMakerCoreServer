module.exports = {
  apps: [
    {
      name: 'inhouse-maker-server-development',
      cwd: __dirname,
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      env_file: '.env.development',
      env: {
        NODE_ENV: 'development',
        APP_ENV: 'development',
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
      env_file: '.env.production',
      env: {
        NODE_ENV: 'production',
        APP_ENV: 'production',
      },
    },
  ],
};
