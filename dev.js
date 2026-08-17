// JackIn — dev launcher: spawns the API server and the web app together.
const { spawn } = require('child_process');

const procs = [
  spawn('npm', ['run', 'dev:server'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev:web'], { stdio: 'inherit' }),
];

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  procs.forEach((p) => {
    try {
      p.kill('SIGINT');
      setTimeout(() => {
        try { p.kill('SIGTERM'); } catch {}
      }, 400);
    } catch {}
  });
  setTimeout(() => process.exit(0), 800);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

procs.forEach((p) => {
  p.on('exit', (code) => {
    if (!shuttingDown && code !== 0 && code !== null) {
      console.error(`[dev] subprocess exit code ${code}`);
      shutdown();
    }
  });
});
