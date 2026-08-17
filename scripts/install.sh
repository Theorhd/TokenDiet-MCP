#!/usr/bin/env bash
set -e

# TokenDiet One-Liner Installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/theorhd/TokenDiet/main/scripts/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/theorhd/TokenDiet/main/scripts/install.sh | bash -s -- --all

echo "🍽️  TokenDiet — Automated MCP & Skill Installer"
echo "==============================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed. Please install Node.js >= 22.13."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
NODE_MINOR=$(echo "$NODE_VERSION" | cut -d'.' -f2)

if [ "$NODE_MAJOR" -lt 22 ] || ([ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]); then
    echo "⚠️  Warning: TokenDiet requires Node.js >= 22.13 (detected v$NODE_VERSION)."
    echo "   Built-in SQLite features may not work on older Node versions."
fi

# Run installer via npx
if command -v npx &> /dev/null; then
    echo "📦 Running installer via npx..."
    npx -y tokendiet-mcp install "$@"
else
    echo "❌ npx command not found. Please install npm."
    exit 1
fi
