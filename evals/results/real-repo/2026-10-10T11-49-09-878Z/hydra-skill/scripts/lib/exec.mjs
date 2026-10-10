import { execFile } from 'node:child_process';

// No shell: argv reaches the program as written, so nothing in it is interpreted.
export function run(cmd, argv, cwd, env = {}) {
  return new Promise(resolve => {
    execFile(
      cmd,
      argv,
      { cwd, env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, out, err) =>
        resolve({
          ok: !error,
          exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          out: out ?? '',
          err: err ?? '',
        }),
    );
  });
}
