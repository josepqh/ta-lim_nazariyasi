// Development: the API (tests/dev-server.js) on :3000 and Vite with hot reload on :5173, which forwards /api.
const { spawn } = require('node:child_process');

const children = [
  spawn(process.execPath, ['tests/dev-server.js'], { stdio: 'inherit', env: { ...process.env, API_ONLY: '1', PORT: '3000' } }),
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite'], { stdio: 'inherit' })
];
const stop = () => children.forEach((child) => child.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((child) => child.on('exit', (code) => { stop(); process.exitCode = code ?? 0; }));
