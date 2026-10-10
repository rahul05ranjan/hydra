import { spawn } from 'node:child_process';

export function runSession(argv, cwd, timeoutMs, paths) {
  const started = Date.now();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CLAUDE')));
  delete env.HYDRA_MODEL; // use the project's installed Hydra Nano family
  return new Promise(resolve => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', error = null, escalation;
    child.stdout.on('data', b => { stdout += b; paths.stdout.write(b); });
    child.stderr.on('data', b => { stderr += b; paths.stderr.write(b); });
    child.on('error', e => { error = e.message; });
    const stop = signal => { if (child.pid) try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch { /* already stopped */ } };
    const cancel = () => { error = 'Cancelled by signal'; stop('SIGTERM'); escalation = setTimeout(() => stop('SIGKILL'), 5000); };
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    const timer = setTimeout(() => { error = 'Session deadline'; stop('SIGTERM'); escalation = setTimeout(() => stop('SIGKILL'), 5000); }, timeoutMs);
    child.on('close', async exitCode => { clearTimeout(timer); clearTimeout(escalation); process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
      await Promise.all([paths.stdout, paths.stderr].map(s => new Promise(done => s.end(done))));
      resolve({ stdout, stderr, exitCode, error, seconds: (Date.now() - started) / 1000 }); });
  });
}
