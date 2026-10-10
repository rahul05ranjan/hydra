const FILES_FIRST = /^\s*(where|find|locate|which files?|how is|how does)\b/i;
const TEST = /\b(tests?|test failure|build failure|compile error|failing tests?)\b/i;
const READ =
  /^\s*(read|slice|cat|outline|view code|inspect)\b|\b(outline of|slice lines?|lines \d+[:-]\d+)\b/i;
const FILE_AND_CODE = /\b[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9_]+\b/i;
const OS = /\b(listening ports?|ports? (?:are )?listening|open ports?|running processes?|processes? running|cpu usage|ram usage|memory usage|disk space|disk usage|system info|system uptime|uptime|load average|os version)\b/i;
const GIT =
  /\b(git|commit(s|ted)?|branch(es)?|diff|staged|unstaged|uncommitted|untracked|merged?|rebased?|stash(ed)?|blame|who (changed|wrote|touched)|(last|recent|latest) changes?|(last|recently) (modified|changed|updated|edited))\b/i;

// Routing is code, not a model: it must be the same every time and cost nothing.
export function route(question, inRepo) {
  if (TEST.test(question)) return 'test';
  if (!inRepo || FILES_FIRST.test(question)) return 'files';
  if (READ.test(question) || (FILE_AND_CODE.test(question) && /\b(show|read|slice|outline|implementation|defined in)\b/i.test(question))) {
    return 'read';
  }
  if (OS.test(question) && !GIT.test(question)) return 'os';
  return GIT.test(question) ? 'git' : 'files';
}
