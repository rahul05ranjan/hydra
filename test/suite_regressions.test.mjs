import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../skills/hydra/scripts/lib/test_logs.mjs';

test('Rust panic digest preserves both compared values even when model cites only header', async () => {
  const prefix = 'runner setup complete\n'.repeat(60);
  const output = `${prefix}thread 'token_expiry' panicked at src/auth.rs:112:9:\nassertion \`left == right\` failed\n  left: 300\n right: 360\n`;
  const result = await digest({ cmd: 'cargo test', out: output, exitCode: 1 }, async () => ({ lines: [61, 112] }));
  assert.ok(result.text.includes('left: 300'));
  assert.ok(result.text.includes('right: 360'));
});
