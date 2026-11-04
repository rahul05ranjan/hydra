import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// The 128+signal convention shells use for signal-terminated commands.
const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15, SIGABRT: 6, SIGBUS: 7, SIGFPE: 8, SIGSEGV: 11, SIGPIPE: 13, SIGALRM: 14 };
const signalNumber = name => SIGNALS[name] ?? 15;

// No shell: argv reaches the program as written, so nothing in it is interpreted.
export function run(cmd, argv, cwd, env = {}) {
  // Windows batch shims cannot be launched by execFile. Use the package's
  // Node entry point directly so argument text never passes through a shell.
  if (process.platform === 'win32' && ['npm', 'npx'].includes(cmd.toLowerCase())) {
    const name = cmd.toLowerCase();
    const directories = String(env.PATH ?? env.Path ?? process.env.PATH ?? '').split(path.delimiter);
    directories.push(path.dirname(process.execPath));
    for (const entry of directories) {
      const directory = entry.replace(/^"|"$/g, '');
      const cli = path.join(directory, 'node_modules', 'npm', 'bin', `${name}-cli.js`);
      if (!existsSync(path.join(directory, `${name}.cmd`)) || !existsSync(cli)) continue;
      const node = path.join(directory, 'node.exe');
      cmd = existsSync(node) ? node : process.execPath;
      argv = [cli, ...argv];
      break;
    }
  }
  return new Promise(resolve => {
    execFile(
      cmd,
      argv,
      { cwd, env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, out, err) =>
        resolve({
          ok: !error,
          // A killed command is not a failing one: keep the real exit code when
          // there is one, and use the 128+signal convention when a signal ended
          // it, so a digest never presents a killed run as an ordinary exit-1
          // test failure. A launch failure (ENOENT) stays exit 1.
          exitCode: error
            ? typeof error.code === 'number'
              ? error.code
              : error.signal
                ? 128 + signalNumber(error.signal)
                : 1
            : 0,
          signal: error?.signal ?? undefined,
          out: out ?? '',
          err: err || error?.message || '',
        }),
    );
  });
}
