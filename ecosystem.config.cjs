module.exports = {
  apps: [
    {
      name: "standing-orders",
      script: "npm",
      args: "start",
      cwd: "./",
      env: {
        NODE_ENV: "production",
        PORT: 8000,
      },
    },
  ],
};
