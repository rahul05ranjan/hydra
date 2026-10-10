const BASE = (process.env.HYDRA_OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
export const HEAD_MODELS = {
  git: 'hydra-nano:git',
  os: 'hydra-nano:os',
  test: 'hydra-nano:test',
  read: 'hydra-nano:read',
  files: 'hydra-nano:files',
};

export const MODEL = process.env.HYDRA_MODEL ?? 'hydra-nano:git';

export function modelFor(head = 'git') {
  if (process.env.HYDRA_MODEL) return process.env.HYDRA_MODEL;
  return HEAD_MODELS[head] ?? 'hydra-nano:git';
}

// The local model cannot be used at all; callers stop and hand the task back.
export class Unavailable extends Error {}

async function call(path, body, timeoutMs) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Unavailable(`Ollama gave no reply within ${timeoutMs / 1000}s`);
    throw new Unavailable(`cannot reach Ollama at ${BASE} (${e.cause?.code ?? e.name})`);
  }
  if (!res.ok) throw new Unavailable(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// One constrained reply: the schema is enforced by the runtime, so the result is always that shape or a throw.
export async function chat({ system, user, schema, model = MODEL }) {
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
  const { models } = await call('/api/tags', undefined, 5000);
  const clean = name => name.replace(/:latest$/, '');
  return models.some(m => clean(m.name) === clean(target) || m.name === target);
}
