import { localConfig, ensureLocal } from './local.mjs';

const LOCAL = localConfig();
export const BACKEND = process.env.HYDRA_BACKEND ?? LOCAL.backend ?? 'llamacpp';
const LLAMA = BACKEND === 'llamacpp';
const LABEL = LLAMA ? 'llama.cpp' : 'Ollama';
const BASE = (LLAMA ? (process.env.HYDRA_LLAMA_URL ?? LOCAL.url ?? 'http://127.0.0.1:8080') : (process.env.HYDRA_OLLAMA_URL ?? 'http://127.0.0.1:11434')).replace(/\/$/, '');
export const HEAD_MODELS = {
  git: 'hydra-nano:git',
  os: 'hydra-nano:os',
  test: 'hydra-nano:test',
  read: 'hydra-nano:read',
  files: 'hydra-nano:files',
};

export const MODEL = process.env.HYDRA_MODEL ?? (LLAMA ? LOCAL.model : undefined) ?? 'hydra-nano:git';

export function modelFor(head = 'git') {
  if (process.env.HYDRA_MODEL) return process.env.HYDRA_MODEL;
  if (LLAMA && LOCAL.model) return LOCAL.model;
  return HEAD_MODELS[head] ?? 'hydra-nano:git';
}

// The local model cannot be used at all; callers stop and hand the task back.
export class Unavailable extends Error {}

async function call(path, body, timeoutMs) {
  if (!['ollama', 'llamacpp'].includes(BACKEND)) throw new Unavailable(`unknown HYDRA_BACKEND "${BACKEND}"; use ollama or llamacpp`);
  if (LLAMA && LOCAL.managed && !process.env.HYDRA_LLAMA_URL) {
    try { await ensureLocal(LOCAL); }
    catch (error) { throw new Unavailable(error.message); }
  }
  let res;
  try {
    res = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Unavailable(`${LABEL} gave no reply within ${timeoutMs / 1000}s`);
    throw new Unavailable(`cannot reach ${LABEL} at ${BASE} (${e.cause?.code ?? e.name})`);
  }
  if (!res.ok) throw new Unavailable(`${LABEL} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  try {
    const value = await res.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  }
  catch { throw new Unavailable(`${LABEL} returned invalid JSON`); }
}

// One constrained reply: the schema is enforced by the runtime, so the result is always that shape or a throw.
export async function chat({ system, user, schema, model = MODEL }) {
  if (LLAMA) {
    const reply = await call('/v1/chat/completions', {
      model, stream: false, temperature: 0, max_tokens: 512,
      response_format: { type: 'json_schema', schema },
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }, 60_000);
    const choice = reply.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Unavailable('llama.cpp JSON reply exceeded the 512-token limit');
    try {
      const value = JSON.parse(choice?.message?.content);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch { throw new Unavailable('llama.cpp returned no usable JSON object'); }
  }
  const reply = await call(
    '/api/chat',
    {
      model,
      stream: false,
      think: false,
      format: schema,
      // num_predict stops a constrained reply that never closes its JSON from running until the timeout.
      options: { temperature: 0, num_ctx: 8192, num_predict: 512 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    60_000,
  );
  return JSON.parse(reply.message.content);
}

export async function hasModel(target = MODEL) {
  if (LLAMA) {
    const { data } = await call('/v1/models', undefined, 5000);
    if (!Array.isArray(data)) throw new Unavailable('llama.cpp returned an invalid model list');
    return data.some(m => m?.id === target && m.meta !== null);
  }
  const { models } = await call('/api/tags', undefined, 5000);
  const clean = name => name.replace(/:latest$/, '');
  return models.some(m => clean(m.name) === clean(target) || m.name === target);
}
