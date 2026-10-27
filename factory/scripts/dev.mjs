// Dev mode: API with inline worker (tsx watch) + Vite dev server with proxy to the API.
import { spawn } from 'node:child_process';

const procs = [
  ['api', 'npx', ['tsx', 'watch', 'server/main.ts']],
  ['web', 'npx', ['vite', '--config', 'web/vite.config.ts']],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const tag = (line) => `[${name}] ${line}`;
  p.stdout.on('data', (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map(tag).join('\n') + '\n'));
  p.stderr.on('data', (d) => process.stderr.write(d.toString().split('\n').filter(Boolean).map(tag).join('\n') + '\n'));
  p.on('exit', (code) => {
    console.log(tag(`exited with ${code}`));
    for (const q of procs) if (q !== p) q.kill('SIGTERM');
    process.exit(code ?? 0);
  });
  return p;
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => procs.forEach((p) => p.kill(sig)));
