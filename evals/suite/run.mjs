#!/usr/bin/env node
// Development diagnosis only. Never imports/reads git1 or sealed failure rows.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat, modelFor } from '../../skills/hydra/scripts/lib/runtime.mjs';
import { answer } from '../../skills/hydra/scripts/lib/answer.mjs';
import * as files from '../../skills/hydra/scripts/lib/files.mjs';
import * as read from '../../skills/hydra/scripts/lib/read.mjs';
import * as osHead from '../../skills/hydra/scripts/lib/os.mjs';
import { digest } from '../../skills/hydra/scripts/lib/test_logs.mjs';
import { scoreFiles, scoreRead, scoreTest, scoreOS, summarize } from './scoring.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const option = (key, fallback) => process.argv.includes(`--${key}`) ? process.argv[process.argv.indexOf(`--${key}`) + 1] : fallback;
const heads = option('heads', 'files,read,test,os').split(',');
if (heads.some(head => !['files', 'read', 'test', 'os'].includes(head))) throw new Error('Invalid head');
const limit = Number(option('limit', '1000000'));
const output = path.resolve(option('output', path.join(ROOT, 'evals/results/suite/development.json')));
const allRows = [];
const started = Date.now();
const data = name => JSON.parse(readFileSync(path.join(ROOT, name), 'utf8'));

// Plan-to-probe/evidence integration uses deterministic OS fixture responses;
// this is not a native host output benchmark. Keep the real env guardrail.
const originalCmds = new Map(Object.entries(osHead.PROBES).map(([key, handler]) => [key, handler.cmd]));
const envBefore = Object.fromEntries(['HYDRA_SUITE_SAFE', 'HYDRA_SUITE_TOKEN'].map(key => [key, process.env[key]]));
process.env.HYDRA_SUITE_SAFE = 'suite-safe-value';
process.env.HYDRA_SUITE_TOKEN = 'suite-secret-sentinel';
for (const [key, handler] of Object.entries(osHead.PROBES)) {
  if (key !== 'env') handler.cmd = async () => ({ ok: true, out: `fixture-${key}` });
}

try {
  for (const head of heads) {
    const tasks = data(head === 'test' ? 'evals/test_logs/tasks.json' : head === 'os' ? 'evals/suite/os_tasks.json' : `evals/${head}/tasks.json`).slice(0, limit);
    for (const [index, task] of tasks.entries()) {
      const cwd = mkdtempSync(path.join(os.tmpdir(), 'hydra-suite-'));
      const row = { head, id: task.id || `${head}-${index}`, calls: [], model: modelFor(head) };
      let stage = 'plan';
      const headChat = async opts => {
        const call = { stage, model: modelFor(head), startedAt: new Date().toISOString() };
        row.calls.push(call);
        const begin = Date.now();
        try { call.reply = await chat({ ...opts, model: call.model }); return call.reply; }
        catch (error) { call.error = error.message; throw error; }
        finally { call.seconds = (Date.now() - begin) / 1000; }
      };
      const begin = Date.now();
      try {
        let sections;
        let result;
        if (head === 'test') {
          stage = 'evidence';
          result = await digest({ cmd: task.command, out: task.rawOutput, exitCode: task.exitCode }, headChat);
          Object.assign(row, scoreTest(task, result));
        } else {
          if (head === 'files') {
            for (const [name, content] of Object.entries(task.files)) {
              const file = path.join(cwd, name);
              mkdirSync(path.dirname(file), { recursive: true });
              writeFileSync(file, content);
            }
            row.question = task.question;
            sections = await files.gather(task.question, cwd, headChat);
          } else if (head === 'read') {
            const file = path.join(cwd, task.file);
            mkdirSync(path.dirname(file), { recursive: true });
            writeFileSync(file, task.content);
            const query = task.query || {};
            row.question = task.question || (query.outline ? `outline ${task.file}` : query.lines ? `read ${task.file} lines ${query.lines}` : `show ${query.symbol || query.query} in ${task.file}`);
            sections = await read.gather(row.question, cwd, headChat);
          } else {
            row.question = task.question;
            sections = await osHead.gather(task.question, cwd, headChat);
          }
          stage = 'evidence';
          result = await answer(row.question, sections, headChat);
          row.sections = sections;
          const plan = row.calls.find(call => call.stage === 'plan')?.reply;
          Object.assign(row, head === 'files' ? scoreFiles(task, sections, result.text, plan) : head === 'read' ? scoreRead(task, result.text) : scoreOS(task, sections, result.text, plan));
        }
        row.text = result.text;
        row.rawChars = result.rawChars;
      } catch (error) {
        row.solved = false;
        row.error = error.message;
      } finally {
        row.seconds = (Date.now() - begin) / 1000;
        allRows.push(row);
        const relativeTemp = path.relative(path.resolve(os.tmpdir()), path.resolve(cwd));
        if (!relativeTemp || relativeTemp.startsWith('..') || path.isAbsolute(relativeTemp)) throw new Error('Unsafe temp cleanup path');
        rmSync(cwd, { recursive: true, force: true });
        mkdirSync(path.dirname(output), { recursive: true });
        writeFileSync(output, JSON.stringify({ complete: false, rows: allRows }, null, 2) + '\n');
      }
    }
    console.log(JSON.stringify({ head, ...summarize(allRows.filter(row => row.head === head)) }));
  }
} finally {
  for (const [key, cmd] of originalCmds) osHead.PROBES[key].cmd = cmd;
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
const report = { timestamp: new Date().toISOString(), complete: true,
  scope: 'Development diagnosis, existing small fixtures. No 95% release claim. OS uses deterministic probe fixtures with real env guardrail; read gather may make zero planner calls.',
  elapsedSeconds: (Date.now() - started) / 1000,
  byHead: Object.fromEntries(heads.map(head => [head, summarize(allRows.filter(row => row.head === head))])), rows: allRows };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
