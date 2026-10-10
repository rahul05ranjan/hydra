import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = () => process.env.HYDRA_HOME ?? path.join(os.homedir(), '.hydra');
const file = () => path.join(home(), 'ledger.jsonl');

// A rough count that needs no tokenizer; every figure built on it is an estimate.
export const tokens = chars => Math.ceil(chars / 4);

export function record(entry) {
  try {
    mkdirSync(home(), { recursive: true });
    appendFileSync(file(), `${JSON.stringify(entry)}\n`);
  } catch {
    // Accounting must never fail the answer.
  }
}

export function stats() {
  let rows = [];
  try {
    rows = readFileSync(file(), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch {
    // No ledger yet.
  }
  const total = { calls: rows.length, raw: 0, returned: 0, heads: {} };
  for (const row of rows) {
    total.raw += row.raw;
    total.returned += row.returned;
    total.heads[row.head] = (total.heads[row.head] ?? 0) + 1;
  }
  return total;
}
