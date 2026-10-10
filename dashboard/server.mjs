#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RESULTS_DIR = path.join(ROOT, 'evals', 'results');
const PROGRESS_FILE = path.join(RESULTS_DIR, 'live_progress.json');
const LEDGER_FILE = path.join(os.homedir(), '.hydra', 'ledger.jsonl');

const PORT = Number(process.env.PORT || 4140);
let activeProcess = null;

function readJsonSafe(filePath) {
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    // ignore parse error during concurrent write
  }
  return null;
}

function getLedgerStats() {
  try {
    if (!existsSync(LEDGER_FILE)) return { totalCalls: 0, rawTokens: 0, returnedTokens: 0, savedTokens: 0, savingsPct: 0, byHead: {} };
    const lines = readFileSync(LEDGER_FILE, 'utf8').trim().split('\n').filter(Boolean);
    let raw = 0;
    let returned = 0;
    const byHead = {};
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        raw += item.raw || 0;
        returned += item.returned || 0;
        const h = item.head || 'unknown';
        if (!byHead[h]) byHead[h] = { calls: 0, raw: 0, returned: 0 };
        byHead[h].calls++;
        byHead[h].raw += item.raw || 0;
        byHead[h].returned += item.returned || 0;
      } catch (e) {}
    }
    const saved = Math.max(0, raw - returned);
    const savingsPct = raw > 0 ? Number(((saved / raw) * 100).toFixed(1)) : 0;
    return { totalCalls: lines.length, rawTokens: raw, returnedTokens: returned, savedTokens: saved, savingsPct, byHead };
  } catch (e) {
    return { totalCalls: 0, rawTokens: 0, returnedTokens: 0, savedTokens: 0, savingsPct: 0, byHead: {} };
  }
}

function getTrainingStatus() {
  try {
    const tasksDir = path.join(os.homedir(), '.gemini', 'antigravity-ide', 'brain', 'e1e22534-7bee-4bcf-8f87-864066bffefa', '.system_generated', 'tasks');
    if (!existsSync(tasksDir)) return null;
    const files = readdirSync(tasksDir)
      .filter(f => f.endsWith('.log'))
      .map(f => {
        try { return { f, mtime: statSync(path.join(tasksDir, f)).mtimeMs }; } catch(e) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);

    for (const { f } of files) {
      const content = readFileSync(path.join(tasksDir, f), 'utf8');
      if (content.includes('mlx_lm.lora') || content.includes('Training gentle LoRA')) {
        const lines = content.split('\n');
        let currentIter = 0;
        let trainLoss = null;
        let valLoss = null;
        let isDone = content.includes('Successfully installed') || content.includes('100% ·   250/250') || content.includes('Successfully imported');
        for (const line of lines) {
          const m = line.match(/^\s*(\d+)\s+val\s+([\d.]+)/);
          if (m) { currentIter = Number(m[1]); valLoss = Number(m[2]); }
          const m2 = line.match(/^\s*(\d+)\s+([\d.]+)\s*[▲▼]/);
          if (m2) { currentIter = Number(m2[1]); trainLoss = Number(m2[2]); }
        }
        return {
          active: !isDone,
          iter: currentIter,
          maxIters: 250,
          trainLoss,
          valLoss,
          isDone
        };
      }
    }
  } catch (e) {}
  return null;
}

function getSystemStatus() {
  const progress = readJsonSafe(PROGRESS_FILE) || { active: false };
  const training = getTrainingStatus();

  // Collect results
  const gitDevBase = readJsonSafe(path.join(RESULTS_DIR, 'git_dev.qwen3.5-0.8b.json'));
  const gitDevLora = readJsonSafe(path.join(RESULTS_DIR, 'git_dev.hydra-qwen3.5-0.8b-plan.json'));
  const git1Base = readJsonSafe(path.join(RESULTS_DIR, 'git1.qwen3.5-0.8b.json'));
  const git1Lora = readJsonSafe(path.join(RESULTS_DIR, 'git1.hydra-qwen3.5-0.8b-plan.json'));
  const testLogs = readJsonSafe(path.join(RESULTS_DIR, 'test_logs.qwen3.5:0.8b.json'));
  const readLogs = readJsonSafe(path.join(RESULTS_DIR, 'read.json'));
  const filesLogs = readJsonSafe(path.join(RESULTS_DIR, 'files.json'));

  const ledger = getLedgerStats();

  const transcripts = {
    totalTokens: 9229923,
    categories: [
      { name: 'file_read', calls: 1997, tokens: 6965419, pct: 75.5, color: '#8b5cf6' },
      { name: 'search', calls: 2264, tokens: 1355217, pct: 14.7, color: '#06b6d4' },
      { name: 'git', calls: 1299, tokens: 667841, pct: 7.2, color: '#10b981' },
      { name: 'other', calls: 371, tokens: 176222, pct: 1.9, color: '#64748b' },
      { name: 'test_build', calls: 308, tokens: 65222, pct: 0.7, color: '#f59e0b' },
    ],
  };

  return {
    timestamp: Date.now(),
    evalRunning: progress.active || !!activeProcess,
    training,
    progress,
    benchmarks: {
      gitDevBase: gitDevBase?.overall || null,
      gitDevLora: gitDevLora?.overall || null,
      git1Base: git1Base?.overall || null,
      git1Lora: git1Lora?.overall || null,
      testLogs: testLogs?.overall || null,
      read: readLogs?.overall || null,
      files: filesLogs?.overall || null,
      agentTrial: readJsonSafe(path.join(RESULTS_DIR, 'agent_trial.json')),
      strictTrial: readJsonSafe(path.join(RESULTS_DIR, 'strict_trial.json')),
    },
    ledger,
    transcripts,
    models: {
      git: 'hydra-nano:git',
      os: 'hydra-nano:os',
      test: 'hydra-nano:test',
      read: 'hydra-nano:read',
      files: 'hydra-nano:files',
    },
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(getSystemStatus()));
    return;
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 1000\n\n');

    const interval = setInterval(() => {
      const data = JSON.stringify(getSystemStatus());
      res.write(`data: ${data}\n\n`);
    }, 400);

    req.on('close', () => {
      clearInterval(interval);
    });
    return;
  }

  if (url.pathname === '/api/eval/start' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const { suite = 'dev', model = 'hydra-nano:git' } = JSON.parse(body || '{}');
        if (activeProcess) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'An evaluation is already running' }));
          return;
        }

        const script = suite === 'git1' ? 'evals/run.mjs' : suite === 'test' ? 'evals/test_logs/run.mjs' : suite === 'read' ? 'evals/read/run.mjs' : 'evals/run_dev.mjs';
        const env = { ...process.env, HYDRA_MODEL: model };
        
        activeProcess = spawn('node', [path.join(ROOT, script)], { cwd: ROOT, env, stdio: 'inherit' });
        activeProcess.on('exit', () => {
          activeProcess = null;
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, suite, model, pid: activeProcess.pid }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Static files
  let filePath = path.join(HERE, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': mime });
    res.end(readFileSync(filePath));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n⚡ Hydra Live Dashboard listening at http://localhost:${PORT}`);
});
