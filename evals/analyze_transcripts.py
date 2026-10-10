#!/usr/bin/env python3
import json
import glob
import os
import re

files = glob.glob(os.path.expanduser("~/.claude/projects/**/*.jsonl"), recursive=True)
print(f"Analyzing {len(files)} Claude Code transcript files...")

categories = {
    "git": {"calls": 0, "chars": 0},
    "test_build": {"calls": 0, "chars": 0},
    "search": {"calls": 0, "chars": 0},
    "file_read": {"calls": 0, "chars": 0},
    "other": {"calls": 0, "chars": 0},
}

GIT_RE = re.compile(r"\bgit\s+(status|log|diff|show|branch|checkout|switch|commit|push|pull|fetch|add|stash|worktree|blame)\b")
TEST_RE = re.compile(r"\b(npm\s+(test|run\s+test|run\s+build)|npx\s+(jest|vitest|mocha|tsc)|pytest|cargo\s+(test|build)|go\s+test|python\s+-m\s+pytest|tsc)\b")
SEARCH_RE = re.compile(r"\b(rg|grep|find|ag|ack)\b")
READ_RE = re.compile(r"\b(cat|head|tail|less|sed|awk)\b")

for path in files:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
            for i, line in enumerate(lines):
                try:
                    d = json.loads(line)
                except Exception:
                    continue

                if d.get("type") == "assistant":
                    msg = d.get("message", {})
                    content = msg.get("content", [])
                    if isinstance(content, list):
                        for block in content:
                            if block.get("type") == "tool_use":
                                tool_name = block.get("name")
                                tool_id = block.get("id")
                                inp = block.get("input", {})
                                cmd = inp.get("command", "")
                                file_path = inp.get("file_path", "")

                                # Find output length in subsequent lines
                                out_chars = 0
                                for next_line in lines[i+1:i+10]:
                                    try:
                                        nd = json.loads(next_line)
                                        if nd.get("type") == "user":
                                            ncontent = nd.get("message", {}).get("content", [])
                                            if isinstance(ncontent, list):
                                                for nb in ncontent:
                                                    if nb.get("type") == "tool_result" and nb.get("tool_use_id") == tool_id:
                                                        out_chars = len(str(nb.get("content", "")))
                                                        break
                                    except Exception:
                                        pass
                                    if out_chars > 0:
                                        break

                                if tool_name == "Bash":
                                    if TEST_RE.search(cmd):
                                        categories["test_build"]["calls"] += 1
                                        categories["test_build"]["chars"] += out_chars
                                    elif GIT_RE.search(cmd):
                                        categories["git"]["calls"] += 1
                                        categories["git"]["chars"] += out_chars
                                    elif SEARCH_RE.search(cmd):
                                        categories["search"]["calls"] += 1
                                        categories["search"]["chars"] += out_chars
                                    elif READ_RE.search(cmd):
                                        categories["file_read"]["calls"] += 1
                                        categories["file_read"]["chars"] += out_chars
                                    else:
                                        categories["other"]["calls"] += 1
                                        categories["other"]["chars"] += out_chars
                                elif tool_name in ["View", "Read", "ReadFile", "read_file"]:
                                    categories["file_read"]["calls"] += 1
                                    categories["file_read"]["chars"] += out_chars
                                elif tool_name in ["Grep", "Glob", "Find", "grep_search", "list_dir"]:
                                    categories["search"]["calls"] += 1
                                    categories["search"]["chars"] += out_chars
    except Exception as e:
        pass

print("\n=== Transcript Analysis Summary ===")
total_chars = sum(c["chars"] for c in categories.values())
total_calls = sum(c["calls"] for c in categories.values())

for cat, data in sorted(categories.items(), key=lambda x: x[1]["chars"], reverse=True):
    tok = data["chars"] // 4
    pct = (data["chars"] / max(1, total_chars)) * 100
    print(f"{cat:12}: {data['calls']:5} calls | ~{tok:8,} tokens ({pct:5.1f}% of tool output tokens)")

print(f"\nTotal output tokens: ~{total_chars // 4:,} tokens across {total_calls} tool calls.")
