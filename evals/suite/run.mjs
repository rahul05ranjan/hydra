#!/usr/bin/env node
// Development diagnosis only. Never imports/reads git1 or sealed failure rows.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
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
const split = option('split', 'legacy');
if (!['legacy', 'development', 'extended', 'holdout', 'holdout2'].includes(split)) throw new Error('Invalid suite split');
const sourceRoot = path.resolve(option('source-root', process.env.HYDRA_EVAL_SOURCE_ROOT || path.join(os.homedir(), '.hydra/quality-sources/files')));
const allRows = [];
const started = Date.now();
const data = name => JSON.parse(readFileSync(path.join(ROOT, name), 'utf8'));
function within(root, name) {
  const file = path.resolve(root, name), relative = path.relative(path.resolve(root), file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Fixture path escaped its intended directory');
  return file;
}
function source(ref) {
  const bytes = readFileSync(within(sourceRoot, ref.source));
  if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new Error('Source fixture changed');
  return bytes.toString('utf8');
}
function writeFixture(cwd, name, content) {
  const file = within(cwd, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content);
}
function rawEvidence(head, task, calls) {
  const evidenceCalls = calls.filter(call => call.stage === 'evidence');
  if (!evidenceCalls.length) return null;
  if (evidenceCalls.some(call => !Array.isArray(call.reply?.lines) || call.reply.lines.some(id => !Number.isInteger(id) || !call.candidates?.some(item => item.id === id)))) return false;
  const text = evidenceCalls.map(call => call.selectedText || '').join('\n');
  if (head === 'read') return scoreRead(task, text).solved;
  if (head === 'test') return scoreTest(task, { text, exitCode: task.exitCode }).solved;
  if (head === 'files') {
    const score = scoreFiles(task, [{ out: text }], text, null); return score.evidence && score.clean;
  }
  return task.gold ? scoreOS(task, [], text, null).evidence : null;
}

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
    const taskPath = split === 'legacy' ? head === 'test' ? 'evals/test_logs/tasks.json' : head === 'os' ? 'evals/suite/os_tasks.json' : `evals/${head}/tasks.json` : `evals/suite/quality/${split}/${head}.json`;
    const tasks = data(taskPath).slice(0, limit);
    for (const [index, task] of tasks.entries()) {
      const cwd = mkdtempSync(path.join(os.tmpdir(), 'hydra-suite-'));
      const row = { head, id: task.id || `${head}-${index}`, family: task.family || `legacy-${head}`, calls: [], model: modelFor(head),
        modelIdentity: process.env.HYDRA_EVAL_MODEL_IDENTITY ? JSON.parse(process.env.HYDRA_EVAL_MODEL_IDENTITY) : null };
      const taskEnvBefore = Object.fromEntries(Object.keys(task.env || {}).map(key => [key, process.env[key]]));
      let stage = 'plan';
      const headChat = async opts => {
        const call = { stage, model: modelFor(head), startedAt: new Date().toISOString() };
        row.calls.push(call);
        const begin = Date.now();
        if (stage === 'evidence') call.candidates = [...opts.user.matchAll(/^\[(\d+)\] (.*)$/gm)].map(match => ({ id: Number(match[1]), text: match[2] }));
        try {
          call.reply = await chat({ ...opts, model: call.model });
          if (call.candidates) call.selectedText = call.candidates.filter(item => call.reply?.lines?.includes(item.id)).map(item => item.text).join('\n');
          return call.reply;
        }
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
              writeFixture(cwd, name, content);
            }
            for (const [name, ref] of Object.entries(task.sourceFiles || {})) writeFixture(cwd, name, source(ref));
            row.question = task.question;
            sections = await files.gather(task.question, cwd, headChat);
          } else if (head === 'read') {
            if (!task.missingFile) writeFixture(cwd, task.file, task.sourceRef ? source(task.sourceRef) : task.content);
            const query = task.query || {};
            row.question = task.question || (query.outline ? `outline ${task.file}` : query.lines ? `read ${task.file} lines ${query.lines}` : `show ${query.symbol || query.query} in ${task.file}`);
            sections = await read.gather(row.question, cwd, headChat);
          } else {
            for (const [key, value] of Object.entries(task.env || {})) {
              if (value === null) delete process.env[key]; else process.env[key] = value;
            }
            if (task.probeOutputs) for (const [key, handler] of Object.entries(osHead.PROBES)) {
              if (key !== 'env') handler.cmd = async args => {
                const fixture = task.probeOutputs[key] || { ok: false, out: 'No output fixture for this probe' };
                if (key !== 'processes' || !args?.name || !fixture.ok) return fixture;
                const lines = fixture.out.split('\n');
                const found = lines.slice(1).filter(line => line.toLowerCase().includes(args.name.toLowerCase()));
                return { ok: true, out: found.length ? [lines[0], ...found].join('\n') : `(no processes matching ${args.name})` };
              };
            }
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
        row.modelEvidence = rawEvidence(head, task, row.calls);
      } catch (error) {
        row.solved = false;
        row.error = error.message;
        if (row.calls.some(call => call.stage === 'plan')) row.modelPlan = false;
        if (row.calls.some(call => call.stage === 'evidence')) row.modelEvidence = false;
      } finally {
        for (const [key, value] of Object.entries(taskEnvBefore)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        row.seconds = (Date.now() - begin) / 1000;
        allRows.push(row);
        const relativeTemp = path.relative(path.resolve(os.tmpdir()), path.resolve(cwd));
        if (!relativeTemp || relativeTemp.startsWith('..') || path.isAbsolute(relativeTemp)) throw new Error('Unsafe temp cleanup path');
        rmSync(cwd, { recursive: true, force: true });
        mkdirSync(path.dirname(output), { recursive: true });
        if (allRows.length % 25 === 0 || index === tasks.length - 1) writeFileSync(output, JSON.stringify({ complete: false, rows: allRows }, null, 2) + '\n');
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
  split, scope: split === 'legacy' ? 'Development diagnosis, existing small fixtures. No 95% release claim. OS uses deterministic probe fixtures with real env guardrail; read gather may make zero planner calls.' : 'Independent per-head quality corpus. OS probe-output fixtures and real env guardrail; native host proof separate. Actual artifact identities and raw plan/evidence attribution recorded. No pooled release claim.',
  elapsedSeconds: (Date.now() - started) / 1000,
  byHead: Object.fromEntries(heads.map(head => [head, summarize(allRows.filter(row => row.head === head))])),
  byFamily: Object.fromEntries([...new Set(allRows.map(row => `${row.head}/${row.family}`))].map(key => [key, summarize(allRows.filter(row => `${row.head}/${row.family}` === key))])), rows: allRows };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
