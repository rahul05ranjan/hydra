import os from 'node:os';
import { run } from './exec.mjs';
import { Unavailable } from './ollama.mjs';

const IS_MAC = process.platform === 'darwin';
const SENSITIVE_PATTERN = /(?:SECRET|KEY|TOKEN|PASS|AUTH|CREDENTIAL|PRIVATE|CLOUDFLARE|API)/i;

export const PROBES = {
  ports: {
    about: 'listening TCP ports and which processes/services are bound to them',
    cmd: async () => {
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
    about: 'disk space usage, available filesystem storage, mount points',
    cmd: async () => {
      const r = await run('df', ['-h']);
      return { ok: r.ok, out: r.out || r.err };
    },
  },
  system: {
    about: 'OS platform, OS version, kernel release, architecture, uptime, system load',
    cmd: async () => {
      const uname = await run('uname', ['-smr']);
      const uptime = await run('uptime', []);
      let osVer = '';
      if (IS_MAC) {
        const sw = await run('sw_vers', []);
        osVer = sw.out ? `\n${sw.out.trim()}` : '';
      }
      return {
        ok: true,
        out: `OS Architecture: ${uname.out.trim()}${osVer}\nUptime / Load:  ${uptime.out.trim()}`,
      };
    },
  },
  memory: {
    about: 'system RAM usage, free memory, memory pressure',
    cmd: async () => {
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
      return { ok: r.ok, out: r.out || r.err };
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
Choose 1 to 2 probes from this list:
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
"what is NODE_ENV set to?" -> {"probes":[{"probe":"env","var":"NODE_ENV"}]}`;

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
  if (!plan.length) {
    const q = question.toLowerCase();
    if (q.includes('port') || q.includes('listen') || q.includes('socket')) {
      plan.push({ probe: 'ports' });
    } else if (q.includes('process') || q.includes('pid') || q.includes('running') || q.includes('cpu')) {
      const m = q.match(/\b(node|python|ollama|postgres|mysql|redis|docker|git|cargo)\b/);
      plan.push({ probe: 'processes', name: m ? m[1] : undefined });
    } else if (q.includes('disk') || q.includes('space') || q.includes('filesystem') || q.includes('storage')) {
      plan.push({ probe: 'disk' });
    } else if (q.includes('ram') || q.includes('memory') || q.includes('swap')) {
      plan.push({ probe: 'memory' });
    } else if (q.includes('env') || q.includes('path') || q.includes('variable')) {
      const m = question.match(/\b([A-Z0-9_]{3,30})\b/);
      plan.push({ probe: 'env', var: m ? m[1] : 'PATH' });
    } else {
      plan.push({ probe: 'system' });
    }
  }

  const results = [];
  for (const item of plan.slice(0, 3)) {
    const handler = PROBES[item.probe];
    if (!handler) continue;
    const res = await handler.cmd(item);
    const cmdLabel = item.name ? `os ${item.probe} --name=${item.name}` : (item.var ? `os ${item.probe} --var=${item.var}` : `os ${item.probe}`);
    results.push({
      probe: item.probe,
      args: item,
      cmd: cmdLabel,
      out: res.out || '(no output)',
    });
  }

  return results;
}
