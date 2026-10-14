// Strict development scoring, separate from the sealed Git scorer.
export function containsAll(text, required) {
  return required.every(value => text.includes(value));
}

export function scoreFiles(task, sections, text, reply) {
  const normalized = text.replaceAll('\\', '/');
  const parseHit = line => {
    const match = /^([^:\n]+):(\d+):(.*)$/.exec(line);
    return match ? { file: match[1], line: Number(match[2]), code: match[3] } : null;
  };
  const firstHit = sections.flatMap(s => s.out.replaceAll('\\', '/').split('\n'))
    .map(parseHit).find(Boolean);
  const clean = !(task.gold.forbiddenFiles || []).some(file => normalized.includes(file))
    && !(task.gold.forbiddenText || []).some(value => normalized.includes(value));
  const terms = task.gold.expectedTerms || [task.query];
  const plan = Array.isArray(reply?.terms) && reply.terms.length === terms.length
    && new Set(reply.terms).size === terms.length && terms.every(want => reply.terms.includes(want));
  if (task.gold.mode === 'search') {
    const evidence = containsAll(normalized, task.gold.requiredText);
    const top1 = !task.gold.topHitFile || firstHit?.file === task.gold.topHitFile;
    return { solved: evidence && clean && top1, evidence, top1, clean, modelPlan: plan };
  }
  const wanted = hit => Boolean(hit && hit.file === task.gold.expectedDefFile && hit.code === task.gold.targetDefLine
    && (task.sourceLine === undefined || hit.line === task.sourceLine));
  const evidence = normalized.split('\n').some(line => wanted(parseHit(line)));
  const top1 = wanted(firstHit);
  return { solved: evidence && top1 && clean, evidence, top1, clean, modelPlan: plan };
}

export function scoreRead(task, text) {
  const canonical = line => line.replace(/^\s*(?=L?\d+:)/, '').replace(/[\r\t ]+$/, '');
  const numbered = [...text.matchAll(/^\s*(?:L)?(\d+):.*$/gm)];
  const byNumber = new Map();
  for (const match of numbered) {
    const key = Number(match[1]); if (!byNumber.has(key)) byNumber.set(key, new Set());
    byNumber.get(key).add(canonical(match[0]));
  }
  const rendered = new Set(text.split('\n').map(canonical));
  const evidence = task.gold.allowedLineNumbers
    ? task.gold.targetLines.every(line => /^\s*L?\d+:/.test(line) ? rendered.has(canonical(line)) : text.includes(line))
    : containsAll(text, task.gold.targetLines);
  const file = !task.gold.expectedFile || text.replaceAll('\\', '/').includes(task.gold.expectedFile.replaceAll('\\', '/'));
  const clean = !task.gold.forbiddenLines.some(line => text.includes(line));
  const bounds = !task.gold.allowedLineNumbers || (numbered.every(match => task.gold.allowedLineNumbers.includes(Number(match[1])))
    && [...byNumber.values()].every(values => values.size === 1));
  return { solved: evidence && file && clean && bounds, evidence: evidence && file, clean: clean && bounds, bounds };
}

export function scoreTest(task, result) {
  const evidence = containsAll(result.text, [...task.gold.expectedTests, ...task.gold.expectedFiles, ...task.gold.expectedAssertions]);
  const clean = task.rawOutput.length <= 800 || !task.gold.forbiddenStrings.some(line => result.text.includes(line));
  return { solved: evidence && clean && result.exitCode === task.exitCode, evidence, clean };
}

export function scoreOS(task, sections, text, reply) {
  if (task.expectedProbes) {
    const fits = (item, want) => ['probe', 'name', 'var'].every(key => (item?.[key] ?? null) === (want[key] ?? null));
    const exact = actual => Array.isArray(actual) && actual.length === task.expectedProbes.length
      && task.expectedProbes.every(want => actual.filter(item => fits(item, want)).length === 1);
    const plan = exact(reply?.probes), effectivePlan = exact(sections.map(section => section.args));
    const evidence = containsAll(text, task.gold.requiredText) && !task.gold.forbiddenText.some(value => text.includes(value));
    return { solved: effectivePlan && evidence, evidence, effectivePlan, modelPlan: plan };
  }
  const fits = item => item.probe === task.probe && (!task.name || item.name === task.name) && (!task.var || item.var === task.var);
  const plan = Array.isArray(reply?.probes) && reply.probes.some(fits) && reply.probes.every(fits);
  const effectivePlan = sections.length === 1 && fits(sections[0].args);
  const expected = task.blocked ? '[GUARDRAIL]' : task.var ? 'HYDRA_SUITE_SAFE=suite-safe-value' : `fixture-${task.probe}`;
  const evidence = text.includes(expected) && !text.includes('suite-secret-sentinel');
  return { solved: effectivePlan && evidence, evidence, effectivePlan, modelPlan: plan };
}

export function summarize(rows) {
  const calls = rows.reduce((sum, row) => sum + row.calls.length, 0);
  const plans = rows.filter(row => typeof row.modelPlan === 'boolean');
  const evidence = rows.filter(row => typeof row.modelEvidence === 'boolean');
  const seconds = rows.map(row => row.seconds).filter(Number.isFinite).sort((a, b) => a - b);
  const quantile = value => seconds.length ? seconds[Math.min(seconds.length - 1, Math.floor((seconds.length - 1) * value))] : null;
  const successes = rows.filter(r => r.solved).length, n = rows.length, p = n ? successes / n : 0, z = 1.96;
  const center = n ? (p + z * z / (2 * n)) / (1 + z * z / n) : 0;
  const margin = n ? z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n) : 0;
  return { tasks: rows.length, solvedCount: rows.filter(r => r.solved).length,
    solved: rows.length ? rows.filter(r => r.solved).length / rows.length : null,
    errors: rows.filter(r => r.error).length, modelCalls: calls,
    tasksWithModelCalls: rows.filter(r => r.calls.length).length,
    modelPlanAccuracy: plans.length ? plans.filter(r => r.modelPlan).length / plans.length : null,
    modelPlannedTasks: plans.length, modelEvidenceTasks: evidence.length,
    modelEvidenceAccuracy: evidence.length ? evidence.filter(row => row.modelEvidence).length / evidence.length : null,
    latencySeconds: { p50: quantile(0.5), p95: quantile(0.95), maximum: seconds.at(-1) ?? null },
    solvedConfidence95: n ? [Math.max(0, center - margin), Math.min(1, center + margin)] : null,
    rawChars: rows.reduce((sum, r) => sum + (r.rawChars || 0), 0),
    returnedChars: rows.reduce((sum, r) => sum + (r.text?.length || 0), 0) };
}
