// Strict development scoring, separate from the sealed Git scorer.
export function containsAll(text, required) {
  return required.every(value => text.includes(value));
}

export function scoreFiles(task, sections, text, reply) {
  const normalized = text.replaceAll('\\', '/');
  const firstHit = sections.flatMap(s => s.out.replaceAll('\\', '/').split('\n'))
    .find(line => /^[^:\n]+:\d+:/.test(line));
  const clean = !(task.gold.forbiddenFiles || []).some(file => normalized.includes(file));
  const evidence = normalized.includes(task.gold.expectedDefFile) && normalized.includes(task.gold.targetDefLine);
  const top1 = Boolean(firstHit?.includes(task.gold.expectedDefFile) && firstHit.includes(task.gold.targetDefLine));
  const plan = Array.isArray(reply?.terms) && reply.terms.some(term => typeof term === 'string' && term.toLowerCase() === task.query.toLowerCase());
  return { solved: evidence && top1 && clean, evidence, top1, clean, modelPlan: plan };
}

export function scoreRead(task, text) {
  const evidence = containsAll(text, task.gold.targetLines);
  const clean = !task.gold.forbiddenLines.some(line => text.includes(line));
  return { solved: evidence && clean, evidence, clean };
}

export function scoreTest(task, result) {
  const evidence = containsAll(result.text, [...task.gold.expectedTests, ...task.gold.expectedFiles, ...task.gold.expectedAssertions]);
  const clean = task.rawOutput.length <= 800 || !task.gold.forbiddenStrings.some(line => result.text.includes(line));
  return { solved: evidence && clean && result.exitCode === task.exitCode, evidence, clean };
}

export function scoreOS(task, sections, text, reply) {
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
  return { tasks: rows.length, solvedCount: rows.filter(r => r.solved).length,
    solved: rows.length ? rows.filter(r => r.solved).length / rows.length : null,
    errors: rows.filter(r => r.error).length, modelCalls: calls,
    tasksWithModelCalls: rows.filter(r => r.calls.length).length,
    modelPlanAccuracy: plans.length ? plans.filter(r => r.modelPlan).length / plans.length : null,
    rawChars: rows.reduce((sum, r) => sum + (r.rawChars || 0), 0),
    returnedChars: rows.reduce((sum, r) => sum + (r.text?.length || 0), 0) };
}
