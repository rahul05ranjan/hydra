import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';

const child = (args, env) => new Promise(resolve => {
  execFile(process.execPath, args, { env: { ...process.env, HYDRA_MODEL: 'fixture-model', ...env }, timeout: 10000 },
    (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
});
const cli = 'skills/hydra/scripts/hydra.mjs';
const schema = { type: 'object', properties: { probes: { type: 'array' } }, required: ['probes'] };
const chatScript = `import {chat,Unavailable} from './skills/hydra/scripts/lib/runtime.mjs';
try {console.log(JSON.stringify(await chat({system:'menu',user:'question',schema:${JSON.stringify(schema)}})));}
catch(e){if(!(e instanceof Unavailable))throw e;console.error(e.message);process.exitCode=2;}`;

test('runtime and CLI support llama.cpp without Ollama', async t => {
  const requests = [];
  let mode = 'ok';
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ url: req.url, body: raw ? JSON.parse(raw) : undefined });
    res.setHeader('content-type', 'application/json');
    if (mode === 'http') { res.writeHead(503); res.end('loading'); return; }
    if (mode === 'invalid') { res.end('not json'); return; }
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: mode === 'missing' ? 'different-model' : 'fixture-model' }] })); return; }
    if (req.url === '/v1/chat/completions') {
      res.end(JSON.stringify({ choices: [{ finish_reason: mode === 'length' ? 'length' : 'stop', message: { content: mode === 'content' ? 'broken' : mode === 'empty' ? '{}' : JSON.stringify({ probes: [{ probe: 'status' }] }) } }] })); return;
    }
    if (req.url === '/api/chat') { res.end(JSON.stringify({ message: { content: '{"probes":[]}' } })); return; }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const env = { HYDRA_BACKEND: 'llamacpp', HYDRA_LLAMA_URL: url, HYDRA_OLLAMA_URL: 'http://127.0.0.1:1' };
  try {
    await t.test('schema, limits, model and thinking options reach the server', async () => {
      const r = await child(['--input-type=module', '-e', chatScript], env);
      assert.equal(r.code, 0, r.stderr);
      const request = requests.at(-1);
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.body.model, 'fixture-model');
      assert.deepEqual(request.body.response_format, { type: 'json_schema', json_schema: { name: 'hydra_reply', schema, strict: true } });
      assert.equal(request.body.max_tokens, 512);
      assert.equal(request.body.temperature, 0);
      assert.equal(request.body.stream, false);
      assert.equal(request.body.chat_template_kwargs.enable_thinking, false);
      assert.deepEqual(request.body.messages, [{ role: 'system', content: 'menu' }, { role: 'user', content: 'question' }]);
    });
    await t.test('doctor checks the actual override once for all heads', async () => {
      requests.length = 0;
      const r = await child([cli, 'doctor'], env);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /llamacpp: reachable/);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, '/v1/models');
      mode = 'missing';
      assert.equal((await child([cli, 'doctor'], env)).code, 2);
      mode = 'ok';
    });
    await t.test('Git CLI executes fixed probes through the new backend', async () => {
      const r = await child([cli, 'ask', '--head', 'git', 'show modified files'], env);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /git status/);
    });
    await t.test('HTTP errors, malformed responses and truncated JSON stop calls', async () => {
      for (const [value, pattern] of [['http', /llama.cpp answered 503/], ['invalid', /invalid JSON/], ['content', /no usable JSON object/], ['empty', /no usable JSON object/], ['length', /512-token limit/]]) {
        mode = value;
        const r = await child(['--input-type=module', '-e', chatScript], env);
        assert.equal(r.code, 2);
        assert.match(r.stderr, pattern);
      }
      mode = 'ok';
    });
    await t.test('setup prints instructions without contacting either server', async () => {
      requests.length = 0;
      const r = await child([cli, 'setup'], env);
      assert.equal(r.code, 0);
      assert.match(r.stdout, /llama-server -m/);
      assert.equal(requests.length, 0);
    });
    await t.test('llama.cpp is the default transport', async () => {
      const r = await child(['--input-type=module', '-e', chatScript], { ...env, HYDRA_BACKEND: undefined });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(requests.at(-1).url, '/v1/chat/completions');
    });
    await t.test('Ollama remains available by explicit selection', async () => {
      const r = await child(['--input-type=module', '-e', chatScript], { HYDRA_BACKEND: 'ollama', HYDRA_OLLAMA_URL: url });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(requests.at(-1).url, '/api/chat');
      assert.deepEqual(requests.at(-1).body.format, schema);
    });
    await t.test('unknown backends fail with actionable messages', async () => {
      const r = await child([cli, 'doctor'], { HYDRA_BACKEND: 'typo' });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /unknown HYDRA_BACKEND/);
    });
    await t.test('an unreachable llama server stops rather than guessing', async () => {
      const r = await child([cli, 'ask', '--head', 'git', 'current branch'], { ...env, HYDRA_LLAMA_URL: 'http://127.0.0.1:1' });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /cannot reach llama.cpp/);
      assert.equal(r.stdout, '');
    });
    await t.test('legacy imports share the same Unavailable class', async () => {
      const r = await child(['--input-type=module', '-e', `import {Unavailable as a} from './skills/hydra/scripts/lib/ollama.mjs';import {Unavailable as b} from './skills/hydra/scripts/lib/runtime.mjs';if(a!==b)process.exitCode=1;`], env);
      assert.equal(r.code, 0, r.stderr);
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
