import os from 'node:os';
import { run } from './exec.mjs';
import { Unavailable } from './runtime.mjs';

const IS_MAC = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';
const result = r => ({ ok: r.ok, out: r.out || r.err || (r.ok ? '(no output)' : '(probe failed)') });
const powershell = script => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
const SENSITIVE_PATTERN = /(?:SECRET|KEY|TOKEN|PASS|AUTH|CREDENTIAL|PRIVATE|CLOUDFLARE|API)/i;

export const PROBES = {
  ports: {
    about: 'listening TCP ports and which processes/services are bound to them',
    cmd: async () => {
      if (IS_WINDOWS) {
        const r = await run('netstat.exe', ['-ano', '-p', 'tcp']);
        if (!r.ok) return result(r);
        return { ok: true, out: r.out.split(/\r?\n/).filter(line => /LISTENING/.test(line)).join('\n') || '(no listening ports)' };
      }
      if (IS_MAC) {
        const r = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
        return { ok: r.ok, out: r.out || r.err || '(no listening ports)' };
      }
      const r = await run('ss', ['-tulpn']);
      if (r.ok) return { ok: true, out: r.out };
      const netstat = await run('netstat', ['-tulpn']);
      return { ok: netstat.ok, out: netstat.out || netstat.err || '(no listening ports)' };
    },
  },
  processes: {
    about: 'running processes, top CPU/memory consumers, or filter by process name (name)',
    cmd: async (args = {}) => {
      if (IS_WINDOWS) {
        const r = await run('tasklist.exe', ['/FO', 'CSV']);
        if (!r.ok) return result(r);
        const lines = r.out.trim().split(/\r?\n/);
        return { ok: true, out: lines.filter((line, i) => i === 0 || !args.name || line.toLowerCase().includes(args.name.toLowerCase())).slice(0, 30).join('\n') };
      }
      if (IS_MAC) {
        const r = await run('ps', ['-eo', 'pid,pcpu,pmem,comm', '-r']);
        if (!r.ok) return { ok: false, out: r.err };
        const lines = (r.out || '').split('\n');
        if (args.name) {
          const filter = args.name.toLowerCase();
          const matched = lines.filter((l, i) => i === 0 || l.toLowerCase().includes(filter));
          return { ok: true, out: matched.slice(0, 30).join('\n') || `(no processes matching ${args.name})` };
        }
        return { ok: true, out: lines.slice(0, 25).join('\n') };
      }
      const r = await run('ps', ['-eo', 'pid,pcpu,pmem,comm', '--sort=-%cpu']);
      if (!r.ok) return result(r);
      const lines = (r.out || '').split('\n');
      if (args.name) {
        const filter = args.name.toLowerCase();
        const matched = lines.filter((l, i) => i === 0 || l.toLowerCase().includes(filter));
        return { ok: true, out: matched.slice(0, 30).join('\n') || `(no processes matching ${args.name})` };
      }
      return { ok: true, out: lines.slice(0, 25).join('\n') };
    },
  },
  disk: {
    about: 'disk space usage, available filesystem storage, mount points (not RAM or swap)',
    cmd: async () => {
      if (IS_WINDOWS) return result(await powershell("Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object @{Name='Filesystem';Expression={$_.DeviceID}}, Size, FreeSpace | Format-Table -AutoSize"));
      const r = await run('df', ['-h']);
      return result(r);
    },
  },
  system: {
    about: 'OS platform, OS version, kernel release, architecture, uptime, system load',
    cmd: async () => {
      return {
        ok: true,
        out: `OS Architecture: ${os.type()} ${os.release()} ${os.arch()}\nUptime: ${Math.floor(os.uptime())} seconds${IS_WINDOWS ? '' : `\nLoad: ${os.loadavg().join(', ')}`}`,
      };
    },
  },
  memory: {
    about: 'system RAM usage, free memory, memory pressure, swap size and usage',
    cmd: async () => {
      if (IS_WINDOWS) return { ok: true, out: `Total Physical RAM: ${(os.totalmem() / 2 ** 30).toFixed(1)} GB\nFree RAM: ${(os.freemem() / 2 ** 30).toFixed(1)} GB` };
      if (IS_MAC) {
        const vm = await run('vm_stat', []);
        const totalGb = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1);
        const freeGb = (os.freemem() / (1024 * 1024 * 1024)).toFixed(1);
        return {
          ok: true,
          out: `Total Physical RAM: ${totalGb} GB\nFree RAM:           ${freeGb} GB\n\nVM Statistics:\n${vm.out.slice(0, 800)}`,
        };
      }
      const r = await run('free', ['-h']);
      return result(r);
    },
  },
  env: {
    about: 'check non-sensitive environment variables (var: name of variable, e.g. PATH, NODE_ENV)',
    cmd: async (args = {}) => {
      const v = (args.var || '').trim();
      if (!v) return { ok: false, out: 'Error: specify environment variable name' };
      if (SENSITIVE_PATTERN.test(v)) {
        return { ok: true, out: `[GUARDRAIL]: Variable "${v}" is flagged sensitive and cannot be inspected.` };
      }
      const val = process.env[v];
      return {
        ok: true,
        out: val !== undefined ? `${v}=${val}` : `Variable "${v}" is not set in environment.`,
      };
    },
  },
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    probes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          probe: { type: 'string', enum: Object.keys(PROBES) },
          name: { type: 'string' },
          var: { type: 'string' },
        },
        required: ['probe'],
      },
      maxItems: 3,
    },
  },
  required: ['probes'],
};

const PLAN_SYSTEM = `You choose read-only OS inspection probes whose output will answer a question about the machine or system.
Choose one probe for each separate thing the question asks about, at most 3, from this list:
${Object.entries(PROBES)
  .map(([name, p]) => `- ${name}: ${p.about}`)
  .join('\n')}

Examples:
"what port is the dashboard listening on?" -> {"probes":[{"probe":"ports"}]}
"which processes are listening on ports?" -> {"probes":[{"probe":"ports"}]}
"is node or python running?" -> {"probes":[{"probe":"processes","name":"node"}]}
"show top processes by CPU" -> {"probes":[{"probe":"processes"}]}
"how much disk space is left?" -> {"probes":[{"probe":"disk"}]}
"what OS version and architecture is this?" -> {"probes":[{"probe":"system"}]}
"how much free memory do I have?" -> {"probes":[{"probe":"memory"}]}
"is the machine paging to swap?" -> {"probes":[{"probe":"memory"}]}
"is storage running low, and is memory tight too?" -> {"probes":[{"probe":"disk"},{"probe":"memory"}]}
"give me the open listeners plus the full process list" -> {"probes":[{"probe":"ports"},{"probe":"processes"}]}
"what is NODE_ENV set to?" -> {"probes":[{"probe":"env","var":"NODE_ENV"}]}`;

// Keyword topic for one clause of a question; null when nothing names a probe.
function topic(text) {
  const q = text.toLowerCase();
  if (/\b(ports?|listen\w*|sockets?)\b/.test(q)) return { probe: 'ports' };
  const processes = () => {
    const m = q.match(/\b(node|python|ollama|postgres|mysql|redis|docker|git|cargo)\b/);
    return { probe: 'processes', name: m ? m[1] : undefined };
  };
  if (/\b(process(es)?|pids?|cpu)\b/.test(q)) return processes();
  if (/\b(ram|memory|swap)\b/.test(q)) return { probe: 'memory' };
  if (/\b(disk|space|filesystems?|storage|mount\w*)\b/.test(q)) return { probe: 'disk' };
  if (/\b(env|environment|path|variables?)\b/.test(q)) {
    // The variable the question names: an ALL_CAPS name first, else the
    // identifier beside the singular word 'variable'/'var' (a lowercase shell
    // variable such as home or pwd is just as valid). A plural 'variables'
    // question names none and keeps the PATH default.
    const named = text.match(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/)
      ?? /\bvariable\s+([A-Za-z_][A-Za-z0-9_]{1,30})\b/i.exec(text)
      ?? /\b([A-Za-z_][A-Za-z0-9_]{1,30})\s+variable\b/i.exec(text)
      ?? /\bvar\s+([A-Za-z_][A-Za-z0-9_]{1,30})\b/i.exec(text);
    return { probe: 'env', var: named ? named[1] : 'PATH' };
  }
  // "running" alone is weak: "the RAM running low" is about memory, checked above.
  return /\brunning\b/.test(q) ? processes() : null;
}
// One topic per clause joined by "and", "or", "plus", "along with" or a comma.
function clauseTopics(question) {
  const found = [];
  for (const clause of question.split(/\b(?:and|or|plus|as well as|along with|together with|also)\b|[,;]/i)) {
    const item = topic(clause);
    if (item && !found.some(other => other.probe === item.probe)) found.push(item);
  }
  return found;
}

const ENV_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const MAX_LISTENERS = 40;
// The one 2-5 digit number in a question that plans the ports probe is the port it asks about.
function namedPort(question) {
  const numbers = question.match(/\b\d{2,5}\b/g) || [];
  return numbers.length === 1 && Number(numbers[0]) <= 65535 ? numbers[0] : null;
}
// Narrow a listener table to one port when the question names it; otherwise bound its length.
function listeners(out, port) {
  const lines = out.split('\n');
  const header = lines.length && !/[:.]\d+\b/.test(lines[0]) ? [lines[0]] : [];
  const body = lines.slice(header.length);
  if (port) {
    const found = body.filter(line => new RegExp(`[:.]${port}(?!\\d)`).test(line));
    return [...header, ...(found.length ? found : [`(no listener on port ${port})`])].join('\n');
  }
  if (body.length <= MAX_LISTENERS) return out;
  return [...header, ...body.slice(0, MAX_LISTENERS), `(${body.length - MAX_LISTENERS} more listeners not shown)`].join('\n');
}

export async function gather(question, cwd, chat) {
  let plan = [];
  if (chat) {
    try {
      const res = await chat({ system: PLAN_SYSTEM, user: question, schema: PLAN_SCHEMA });
      if (Array.isArray(res?.probes)) plan = res.probes;
    } catch (e) {
      if (e instanceof Unavailable) throw e;
    }
  }

  // Fallback heuristics if no model or empty plan
  const topics = clauseTopics(question);
  if (!plan.length) plan = topics.length > 1 ? topics : [topic(question) || { probe: 'system' }];
  // A question that names two topics gets both, even if the model planned only one.
  else if (topics.length > 1) {
    for (const item of topics) if (item.probe !== 'env' && !plan.some(other => other.probe === item.probe)) plan.push(item);
  }
  // A "process name" shaped like an environment variable (BUILD_FLAVOR_17) is an env lookup.
  plan = plan.map(item => item.probe === 'processes' && ENV_NAME.test(item.name || '') ? { probe: 'env', var: item.name } : item);
  // Keep only the argument each probe accepts; the model sometimes invents others.
  const accepts = { processes: 'name', env: 'var' };
  plan = plan.map(item => {
    const key = accepts[item.probe];
    return key && item[key] !== undefined ? { probe: item.probe, [key]: item[key] } : { probe: item.probe };
  });

  const results = [];
  for (const item of plan.slice(0, 3)) {
    const handler = PROBES[item.probe];
    if (!handler) continue;
    const res = await handler.cmd(item);
    if (item.probe === 'ports' && res.ok) res.out = listeners(res.out || '', namedPort(question));
    const cmdLabel = item.name ? `os ${item.probe} --name=${item.name}` : (item.var ? `os ${item.probe} --var=${item.var}` : `os ${item.probe}`);
    results.push({
      probe: item.probe,
      args: item,
      ok: res.ok,
      cmd: cmdLabel,
      out: res.ok ? (res.out || '(no output)') : `[probe failed] ${res.out || '(no output)'}`,
    });
  }

  return results;
}
