import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as refactor from '../skills/hydra/scripts/lib/refactor.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'skills', 'hydra', 'scripts', 'hydra.mjs');

const temp = () => mkdtempSync(path.join(os.tmpdir(), 'hydra-refactor-'));

test('Refactoring.Guru smells and patterns catalog integrity', () => {
  // All 22 smells + 2 complexity/data smells
  assert.ok(Object.keys(refactor.SMELLS_CATALOG).length >= 22);
  assert.ok(refactor.SMELLS_CATALOG['long-method']);
  assert.ok(refactor.SMELLS_CATALOG['large-class']);
  assert.ok(refactor.SMELLS_CATALOG['primitive-obsession']);
  assert.ok(refactor.SMELLS_CATALOG['long-parameter-list']);
  assert.ok(refactor.SMELLS_CATALOG['data-clumps']);
  assert.ok(refactor.SMELLS_CATALOG['switch-statements']);
  assert.ok(refactor.SMELLS_CATALOG['dead-code']);
  assert.ok(refactor.SMELLS_CATALOG['duplicate-code']);
  assert.ok(refactor.SMELLS_CATALOG['feature-envy']);
  assert.ok(refactor.SMELLS_CATALOG['message-chains']);

  // All 22 GoF design patterns across Creational, Structural, Behavioral
  assert.equal(Object.keys(refactor.PATTERNS_CATALOG).length, 22);
  const categories = Object.values(refactor.PATTERNS_CATALOG).map(p => p.category);
  assert.equal(categories.filter(c => c === 'Creational').length, 5);
  assert.equal(categories.filter(c => c === 'Structural').length, 7);
  assert.equal(categories.filter(c => c === 'Behavioral').length, 10);
});

test('scanCode detects Long Method, Long Parameter List, Deep Nesting and Dead Code', () => {
  const code = `
function processUserData(userId, email, firstName, lastName, age, role, department) {
  if (userId) {
    if (email) {
      if (role) {
        if (department) {
          console.log("Deep inside nested logic");
          return true;
          console.log("Unreachable statement");
        }
      }
    }
  }
  return false;
}
`;
  const report = refactor.scanCode(code, 'user.js', { maxParams: 4, maxNesting: 3 });
  assert.ok(report.smellsFound >= 3);

  const smells = report.findings.map(f => f.smell);
  assert.ok(smells.includes('long-parameter-list'));
  assert.ok(smells.includes('deep-nesting'));
  assert.ok(smells.includes('dead-code'));

  const paramFinding = report.findings.find(f => f.smell === 'long-parameter-list');
  assert.equal(paramFinding.symbol, 'processUserData');
  assert.ok(paramFinding.metric.includes('7 parameters'));
});

test('scanCode detects Switch Statements and Data Clumps', () => {
  const code = `
function calculateTax(amount, currency, countryCode) {
  switch (countryCode) {
    case 'US': return amount * 0.1;
    case 'CA': return amount * 0.12;
    case 'GB': return amount * 0.2;
    case 'DE': return amount * 0.19;
    default: return amount * 0.05;
  }
}

function printInvoice(amount, currency, countryCode) {
  return amount + currency + countryCode;
}
`;
  const report = refactor.scanCode(code, 'billing.ts');
  const smells = report.findings.map(f => f.smell);
  assert.ok(smells.includes('switch-statements'));
  assert.ok(smells.includes('data-clumps'));
});

test('scanCode detects Duplicate Code blocks', () => {
  const code = `
function renderHeader() {
  const el = document.createElement('div');
  el.className = 'header-box';
  el.setAttribute('role', 'banner');
  el.textContent = 'Welcome User';
  return el;
}

function renderFooter() {
  const el = document.createElement('div');
  el.className = 'header-box';
  el.setAttribute('role', 'banner');
  el.textContent = 'Welcome User';
  return el;
}
`;
  const report = refactor.scanCode(code, 'ui.js');
  const smells = report.findings.map(f => f.smell);
  assert.ok(smells.includes('duplicate-code'));
});

test('scanDiff detects smells in newly added git diff lines', () => {
  const diff = `
diff --git a/src/service.js b/src/service.js
index 1234567..89abcdef 100644
--- a/src/service.js
+++ b/src/service.js
@@ -10,2 +10,12 @@ export function init() {
+function handleRequest(a, b, c, d, e, f) {
+  if (a) {
+    if (b) {
+      if (c) {
+        if (d) {
+          return 42;
+        }
+      }
+    }
+  }
+}
`;
  const res = refactor.scanDiff(diff);
  assert.equal(res.totalFilesChecked, 1);
  assert.equal(res.filesWithSmells, 1);
  assert.ok(res.reports[0].findings.some(f => f.smell === 'long-parameter-list'));
  assert.ok(res.reports[0].findings.some(f => f.smell === 'deep-nesting'));
});

test('generateRecipe provides actionable Refactoring.Guru steps', () => {
  const code = `
function sendBulkEmail(recipients, subject, body, attachment, replyTo, templateId) {
  if (recipients) {
    if (subject) {
      if (body) {
        if (templateId) {
          return true;
        }
      }
    }
  }
  return false;
}
`;
  const recipe = refactor.generateRecipe(code, { symbol: 'sendBulkEmail' });
  assert.equal(recipe.symbol, 'sendBulkEmail');
  assert.ok(recipe.steps.length >= 2);

  const techniques = recipe.steps.map(s => s.technique);
  assert.ok(techniques.some(t => t.includes('Guard Clauses')));
  assert.ok(techniques.some(t => t.includes('Parameter Object')));
});

test('advisePattern matches patterns directly and by architectural problem', () => {
  // Direct lookup
  const strategy = refactor.advisePattern('strategy');
  assert.equal(strategy.pattern, 'Strategy');
  assert.equal(strategy.category, 'Behavioral');
  assert.ok(strategy.url.includes('/design-patterns/strategy'));

  const observer = refactor.advisePattern('observer');
  assert.equal(observer.pattern, 'Observer');
  assert.ok(observer.intent.includes('subscription mechanism'));

  // Problem search
  const builder = refactor.advisePattern('telescoping constructor with many parameters');
  assert.equal(builder.pattern, 'Builder');

  // Code snippet heuristic
  const state = refactor.advisePattern('', 'switch (this.state) { case "PENDING": case "APPROVED": case "REJECTED": }');
  assert.ok(state.pattern === 'State' || state.pattern === 'Strategy');
});

test('CLI hydra smell, refactor, and design commands work via stdio', () => {
  const dir = temp();
  const testFile = path.join(dir, 'sample.js');
  writeFileSync(testFile, `
function calculate(p1, p2, p3, p4, p5, p6) {
  if (p1) {
    if (p2) {
      if (p3) {
        if (p4) {
          return 99999;
          console.log("unreachable");
        }
      }
    }
  }
}
`);

  // HYDRA_TELEMETRY=0: fixture calls must not land in the user's ledger and skew `hydra improve`.
  const run = args => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, HYDRA_TELEMETRY: '0' } });

  // hydra smell
  const smellOut = run(['smell', testFile]);
  assert.ok(smellOut.includes('[hydra smell]'));
  assert.ok(smellOut.includes('Long Parameter List'));
  assert.ok(smellOut.includes('Deep Nesting'));
  assert.ok(smellOut.includes('Dead Code'));

  // hydra smell --json
  const smellJson = run(['smell', testFile, '--json']);
  const parsedSmell = JSON.parse(smellJson.slice(0, smellJson.indexOf('\n\n[hydra smell')));
  assert.ok(parsedSmell.smellsFound >= 3);

  // hydra refactor
  const refactorOut = run(['refactor', testFile, 'calculate']);
  assert.ok(refactorOut.includes('[hydra refactor]'));
  assert.ok(refactorOut.includes('Guard Clauses'));
  assert.ok(refactorOut.includes('Parameter Object'));

  // hydra design
  const designOut = run(['design', 'strategy']);
  assert.ok(designOut.includes('[hydra design] Strategy Pattern (Behavioral)'));
  assert.ok(designOut.includes('https://refactoring.guru/design-patterns/strategy'));
});
