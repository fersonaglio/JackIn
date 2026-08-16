// JackIn — dev launcher: spawns the API server and the web app together.
// Minimal by design: no voicebox, no MCP. Both watch their sources for reload.
const { spawn } = require('child_process');

const procs = [
  spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', shell: true }),
  spawn('npm', ['run', 'dev:web'], { stdio: 'inherit', shell: true }),
];

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  procs.forEach((p) => {
    try { p.kill('SIGTERM'); } catch {}
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

procs.forEach((p) => {
  p.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[dev] subprocess exit code ${code}`);
      shutdown();
    }
  });
});
