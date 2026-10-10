#!/usr/bin/env bash
set -e

# Hydra One-Command Installer
# Installs the hydra skill, verifies dependencies, and downloads the local 0.8B model.

echo "========================================"
echo "🐉 Hydra Installer"
echo "Small local models for coding agents"
echo "========================================"
echo ""

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Error: Node.js is required (>=18). Please install Node.js first: https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Error: Node.js version must be >= 18 (found $(node -v)). Please update Node.js."
  exit 1
fi
echo "✔ Node.js $(node -v) detected"

# 2. Check Ollama
if ! command -v ollama >/dev/null 2>&1; then
  echo "❌ Error: Ollama is required. Download and install it from: https://ollama.com/download"
  echo "Once installed, run this installer again."
  exit 1
fi
echo "✔ Ollama detected"

# Check if Ollama daemon is running
if ! curl -s http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "⏳ Starting Ollama in background..."
  ollama serve >/dev/null 2>&1 &
  sleep 2
fi

# 3. Pull default model if missing
MODEL="hydra-nano:git"
if ! ollama list 2>/dev/null | grep -q "hydra-nano"; then
  echo "⬇ Setting up $MODEL in Ollama..."
  ollama pull "qwen3.5:0.8b" >/dev/null 2>&1 || true
  ollama cp "qwen3.5:0.8b" "hydra-nano:git" >/dev/null 2>&1 || true
  ollama cp "qwen3.5:0.8b" "hydra-nano-git" >/dev/null 2>&1 || true
  ollama cp "qwen3.5:0.8b" "hydra-nano:os" >/dev/null 2>&1 || true
  ollama cp "qwen3.5:0.8b" "hydra-nano:test" >/dev/null 2>&1 || true
  ollama cp "qwen3.5:0.8b" "hydra-nano:read" >/dev/null 2>&1 || true
  ollama cp "qwen3.5:0.8b" "hydra-nano:files" >/dev/null 2>&1 || true
else
  echo "✔ Local models ($MODEL and specialist heads) present"
fi

# 4. Resolve Hydra source directory
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
SKILL_SRC="$DIR/skills/hydra"

if [ ! -d "$SKILL_SRC" ]; then
  echo "❌ Error: Hydra skill directory not found at $SKILL_SRC"
  exit 1
fi

# 5. Install skill for Claude Code and Antigravity
CLAUDE_DEST="$HOME/.claude/skills/hydra"
GEMINI_DEST="$HOME/.gemini/config/skills/hydra"

mkdir -p "$(dirname "$CLAUDE_DEST")"
rm -rf "$CLAUDE_DEST"
cp -r "$SKILL_SRC" "$CLAUDE_DEST"
chmod +x "$CLAUDE_DEST/scripts/hydra.mjs"
echo "✔ Installed skill to $CLAUDE_DEST"

mkdir -p "$(dirname "$GEMINI_DEST")"
rm -rf "$GEMINI_DEST"
cp -r "$SKILL_SRC" "$GEMINI_DEST"
chmod +x "$GEMINI_DEST/scripts/hydra.mjs"
echo "✔ Installed skill to $GEMINI_DEST"

# 6. Global CLI link in ~/.local/bin if available
if [ -d "$HOME/.local/bin" ]; then
  ln -sf "$SKILL_SRC/scripts/hydra.mjs" "$HOME/.local/bin/hydra"
  echo "✔ Linked CLI to $HOME/.local/bin/hydra"
fi

echo ""
echo "🩺 Running Hydra Doctor..."
node "$SKILL_SRC/scripts/hydra.mjs" doctor || true

echo ""
echo "🎉 Hydra successfully installed!"
echo "Usage:"
echo "  node $SKILL_SRC/scripts/hydra.mjs ask \"<question>\""
echo "  node $SKILL_SRC/scripts/hydra.mjs search \"<symbol>\""
echo "  node $SKILL_SRC/scripts/hydra.mjs read <file> [symbol]"
echo "  node $SKILL_SRC/scripts/hydra.mjs run -- <command...>"
echo "  node $SKILL_SRC/scripts/hydra.mjs stats"
echo ""
