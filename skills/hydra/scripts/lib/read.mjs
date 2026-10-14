import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Unavailable } from './runtime.mjs';

const PASS_THROUGH = 800;
const MAX_FILE_BYTES = 1024 * 1024; // 1 MB limit for local slice reads

const TOP_LEVEL_PATTERNS = [
  /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*([a-zA-Z0-9_$]+)/,
  /^(?:export\s+)?(?:class|interface|type|enum)\s+([a-zA-Z0-9_$]+)/,
  /^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/,
  /^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/,
  /^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(/,
  /^class\s+([a-zA-Z0-9_]+)\s*(?:\(.*\))?:/,
  /^(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+([a-zA-Z0-9_]+)/,
  /^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+([a-zA-Z0-9_]+)/,
  /^func\s+(?:\([^)]*\)\s+)?([a-zA-Z0-9_]+)\s*\(/,
  /^type\s+([a-zA-Z0-9_]+)\s+(?:struct|interface)/,
];

export function outline(content) {
  const lines = content.split('\n');
  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isExport = /^\s*export\b/.test(line);
    const isTopLevel = /^\S/.test(line);
    if (!isExport && !isTopLevel) continue;

    let found = false;
    for (const pat of TOP_LEVEL_PATTERNS) {
      const m = pat.exec(line.trim());
      if (m) {
        items.push({ line: i + 1, name: m[1], preview: line.trim().slice(0, 80) });
        found = true;
        break;
      }
    }
    if (!found) {
      // JS/TS declarations can start with a binding pattern or have no
      // initializer. Keep their header without promoting nested assignments
      // or Rust's typed const declarations into this binding vocabulary.
      const binding = /^(?:export\s+)?(?:const|let|var)\s+(?:([a-zA-Z_$][\w$]*)\s*(?=[=;,]|$)|(\{|\[))/.exec(line.trim());
      if (binding) items.push({ line: i + 1, name: binding[1] || '<binding pattern>', preview: line.trim().slice(0, 80) });
    }
  }
  return items;
}

export function sliceLines(content, start, end) {
  const lines = content.split('\n');
  const s = Math.max(1, start);
  const e = Math.min(lines.length, end);
  return lines.slice(s - 1, e).map((l, i) => `${s + i}: ${l}`).join('\n');
}

export function sliceSymbol(content, symbol, maxContext = 40) {
  const lines = content.split('\n');
  const term = symbol.toLowerCase().trim();

  let targetIndex = -1;
  // Match definitions first
  for (let i = 0; i < lines.length; i++) {
    for (const pat of TOP_LEVEL_PATTERNS) {
      const m = pat.exec(lines[i].trim());
      if (m && m[1].toLowerCase() === term) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex !== -1) break;
  }

  // Second pass: match class methods or functions: foo(...) {
  if (targetIndex === -1) {
    const methodPat = /^\s*(?:async\s+)?(?:get\s+|set\s+)?([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/;
    for (let i = 0; i < lines.length; i++) {
      const m = methodPat.exec(lines[i]);
      if (m && m[1].toLowerCase() === term) {
        targetIndex = i;
        break;
      }
    }
  }

  // Fallback: match any line with symbol as word
  if (targetIndex === -1) {
    const wordRe = new RegExp(`\\b${term}\\b`, 'i');
    for (let i = 0; i < lines.length; i++) {
      if (wordRe.test(lines[i])) {
        targetIndex = i;
        break;
      }
    }
  }

  if (targetIndex === -1) return null;

  let end = targetIndex;
  const isIndentedBlock = /^\s*(?:async\s+)?(?:def|class)\s+/.test(lines[targetIndex]) ||
                          (!lines[targetIndex].includes('{') && /:\s*(?:#.*)?$/.test(lines[targetIndex]));

  const goHeader = lines[targetIndex].replace(/\/\/.*$/, '').trim();
  const bodylessGo = /^func\s+/.test(goHeader) && !/[{}]/.test(goHeader)
    && goHeader.includes('(')
    && (goHeader.match(/\(/g)?.length || 0) === (goHeader.match(/\)/g)?.length || 0);

  if (bodylessGo) {
    // Go declarations backed by assembly/external symbols have no body. The
    // next unrelated function's brace is not this declaration's boundary.
    end = targetIndex;
  } else if (isIndentedBlock) {
    const leadMatch = lines[targetIndex].match(/^(\s*)/);
    const baseIndent = leadMatch ? leadMatch[1].length : 0;
    
    // Find where the definition header ends (supports multi-line parameter signatures)
    let headerEnd = targetIndex;
    while (headerEnd < lines.length - 1 && !/:\s*(?:#.*)?$/.test(lines[headerEnd])) {
      headerEnd++;
    }

    let lastBlockLine = headerEnd;
    for (let i = headerEnd + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const currIndent = line.match(/^(\s*)/)[1].length;
      if (currIndent <= baseIndent) break;
      lastBlockLine = i;
    }
    end = lastBlockLine > targetIndex ? lastBlockLine : Math.min(lines.length - 1, targetIndex + maxContext);
  } else {
    // Block boundary detection with braces
    let braces = 0;
    let sawBrace = false;

    for (let i = targetIndex; i < Math.min(lines.length, targetIndex + 200); i++) {
      // Strip comments, strings, and regexes before counting block braces
      const cleanLine = lines[i]
        .replace(/\/\/.*$/, '')
        .replace(/'(?:\\.|[^'])*'/g, "''")
        .replace(/"(?:\\.|[^"])*"/g, '""')
        .replace(/`(?:\\.|[^`])*`/g, '``')
        .replace(/\/(?:\\.|[^/])+\/[gimsuy]*/g, '//');

      for (const ch of cleanLine) {
        if (ch === '{') { braces++; sawBrace = true; }
        else if (ch === '}') { braces--; }
      }
      end = i;
      if (sawBrace && braces <= 0) break;
    }

    if (!sawBrace) {
      // Indentation-based block detection fallback
      const leadMatch = lines[targetIndex].match(/^(\s*)/);
      const baseIndent = leadMatch ? leadMatch[1].length : 0;
      let lastBlockLine = targetIndex;
      for (let i = targetIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const currIndent = line.match(/^(\s*)/)[1].length;
        if (currIndent <= baseIndent) break;
        lastBlockLine = i;
      }
      end = lastBlockLine > targetIndex ? lastBlockLine : Math.min(lines.length - 1, targetIndex + maxContext);
    }
  }

  // Include leading comment / decorator / docstring if present
  let start = targetIndex;
  while (start > 0 && /^\s*(\/\/|#|\/\*|\*|@)/.test(lines[start - 1])) {
    start--;
  }

  const sliced = lines.slice(start, end + 1).map((l, idx) => `${start + idx + 1}: ${l}`).join('\n');
  return { start: start + 1, end: end + 1, text: sliced };
}

export async function readSlice(fileArg, opts = {}, cwd = process.cwd()) {
  const fullPath = path.isAbsolute(fileArg) ? fileArg : path.resolve(cwd, fileArg);
  const relPath = path.relative(cwd, fullPath);

  if (!existsSync(fullPath)) {
    return { ok: false, error: `File not found: ${relPath}` };
  }

  const st = statSync(fullPath);
  if (st.isDirectory()) {
    return { ok: false, error: `Path is a directory, not a file: ${relPath}` };
  }
  if (st.size > MAX_FILE_BYTES) {
    return { ok: false, error: `File is too large (>1 MB): ${relPath}` };
  }

  const content = readFileSync(fullPath, 'utf8');
  const rawChars = content.length;
  const linesCount = content.split('\n').length;

  // Short files: pass through verbatim unless a specific slice or outline is requested
  if (rawChars <= PASS_THROUGH && !opts.lines && !opts.symbol && !opts.query && !opts.outline) {
    const withNumbers = content.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    return {
      ok: true,
      text: `File: ${relPath} (${linesCount} lines, ${rawChars} chars)\n\n${withNumbers}`,
      rawChars,
      returnedChars: withNumbers.length,
    };
  }

  // Explicit line range
  if (opts.lines) {
    const m = String(opts.lines).match(/^(\d+)[:-](\d+)$/);
    if (m) {
      const s = parseInt(m[1], 10);
      const e = parseInt(m[2], 10);
      const sliced = sliceLines(content, s, e);
      return {
        ok: true,
        text: `File: ${relPath} (lines ${s}-${e} of ${linesCount})\n\n${sliced}`,
        rawChars,
        returnedChars: sliced.length,
      };
    }
  }

  // Symbol or search term
  if (opts.symbol || opts.query) {
    const sym = opts.symbol || opts.query;
    const res = sliceSymbol(content, sym);
    if (res) {
      return {
        ok: true,
        text: `File: ${relPath} (${sym} at lines ${res.start}-${res.end} of ${linesCount})\n\n${res.text}`,
        rawChars,
        returnedChars: res.text.length,
      };
    }
  }

  // Large file without specific symbol, or explicit outline: show structural outline
  const symbols = outline(content);
  let summary = `File: ${relPath} (${linesCount} lines, ~${Math.round(rawChars / 4)} tokens)\n`;
  if (symbols.length > 0) {
    summary += `Outline of definitions (${symbols.length} symbols):\n`;
    summary += symbols.map(s => `  L${s.line}: ${s.preview}`).join('\n');
    summary += `\n\n(To view a specific symbol or lines: hydra read ${relPath} <symbol> or --lines <start-end>)`;
  } else {
    // If no symbols found (e.g. text/data file), show head
    const head = sliceLines(content, 1, 30);
    summary += `Head (lines 1-30 of ${linesCount}):\n\n${head}\n\n(To read more lines: hydra read ${relPath} --lines <start-end>)`;
  }

  return {
    ok: true,
    text: summary,
    rawChars,
    returnedChars: summary.length,
  };
}

export async function gather(question, cwd, chat) {
  // Extract file path from question (e.g. "read src/auth.ts" or "show handleLogin in src/auth.ts")
  const quotedPath = question.match(/(["'])([^"'\r\n]+\.[a-zA-Z0-9_]+)\1/);
  const fileMatch = quotedPath || question.match(/\b([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9_]+)\b/);
  if (!fileMatch) {
    return [{ cmd: 'read', out: 'No file path found in question. Specify a path like: hydra read <path> [symbol]' }];
  }

  const file = quotedPath ? quotedPath[2] : fileMatch[1];
  // Extract line range if present
  const linesMatch = question.match(/\b(?:lines?\s+)?(\d+[:-]\d+)\b/i);
  const lines = linesMatch ? linesMatch[1] : undefined;

  const isOutline = /\boutline\b/i.test(question);

  // Extract possible symbol/term from question (excluding common question words and the filename)
  const prose = question.replace(quotedPath ? quotedPath[0] : file, '');
  const explicitSymbol = /\b(?:function|class|method|symbol)\s+([a-zA-Z_$][\w$]*)\b/i.exec(prose)?.[1]
    || /^\s*(?:show|read|slice)\s+(?:the\s+)?code\s+of\s+([a-zA-Z_$][\w$]*)\b/i.exec(prose)?.[1]
    || /^\s*(?:show|read|slice)\s+(?:the\s+)?([a-zA-Z_$][\w$]*)\s+(?:in|from|at)\b/i.exec(prose)?.[1];
  const words = prose.replace(/[^a-zA-Z0-9_$]/g, ' ').split(/\s+/).filter(w => w.length > 0);
  const STOP = new Set([
    'how', 'what', 'where', 'show', 'read', 'slice', 'tell', 'file', 'code', 'function',
    'class', 'does', 'work', 'defined', 'explain', 'lines', 'line', 'outline', 'in', 'the',
    'of', 'from', 'at',
  ]);
  const term = lines || isOutline ? undefined : explicitSymbol || words.find(w => !STOP.has(w.toLowerCase()));

  const res = await readSlice(file, { query: term, lines, outline: isOutline }, cwd);
  return [{ cmd: `read ${file}${term ? ` ${term}` : lines ? ` ${lines}` : isOutline ? ' outline' : ''}`, out: res.ok ? res.text : res.error }];
}
