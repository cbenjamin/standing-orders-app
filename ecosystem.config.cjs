module.exports = {
  apps: [
    {
      name: "standing-orders",
      script: "node_modules/.bin/react-router-serve",
      args: "./build/server/index.js",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
        PORT: 8000,
        NODE_OPTIONS: "--max-old-space-size=384",
      },
    },
  ],
};
