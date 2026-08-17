# TokenDiet MCP

**Token-efficient codebase exploration for AI agents.** Save 70-90% of tokens when an AI needs to understand a project's architecture.

Instead of reading every file, the agent calls TokenDiet tools that return concise, structured, architecture-focused summaries.

---

## ⚡ Automated 1-Click Installation (Zero-Clone)

Install TokenDiet MCP and its **SKILL.md / Rules** into your AI coding assistant in a single command — **no git clone required**:

### Option 1: Via NPX (Interactive or Direct)

```bash
# Interactive setup (select your tools)
npx -y tokendiet-mcp install

# Or install automatically in all detected tools (Claude Code, Antigravity, OpenCode)
npx -y tokendiet-mcp install --all

# Or target specific tools
npx -y tokendiet-mcp install --claude
npx -y tokendiet-mcp install --antigravity
npx -y tokendiet-mcp install --opencode
```

> **Direct from GitHub without npm:**  
> `npx github:Theorhd/TokenDiet-MCP install --all`

### Option 2: Via Curl One-Liner

```bash
curl -fsSL https://raw.githubusercontent.com/Theorhd/TokenDiet-MCP/main/scripts/install.sh | bash
```

### Check Installation Status or Uninstall

```bash
# Check status across all tools
npx -y tokendiet-mcp status

# Uninstall cleanly
npx -y tokendiet-mcp uninstall --all
```

---

## 🛠️ Local Development Installation (Cloned Repo)

If you clone the repository locally to work on TokenDiet:

```bash
git clone https://github.com/Theorhd/TokenDiet-MCP.git
cd TokenDiet-MCP
npm install
npm run build

# Install into all tools pointing to your local build (dist/index.js)
npm run install:all

# Or target specific tools
npm run install:claude
npm run install:antigravity
npm run install:opencode
```

**Requires Node.js >= 22.13** (for built-in SQLite).

---

## 🎯 Supported Environments & What Is Configured

| Tool | MCP Configuration | SKILL.md / Rules Configured |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude/.mcp.json` & `~/.claude.json` | `~/.claude/skills/tokendiet-mcp/SKILL.md` + `~/.claude/CLAUDE.md` |
| **Google Antigravity** *(IDE & CLI)* | `~/.gemini/config/mcp_config.json` + permissions | `~/.gemini/config/skills/tokendiet-mcp/SKILL.md` + `~/.gemini/config/rules/tokendiet-mcp.md` |
| **OpenCode** | `~/.config/opencode/config.json` | `~/.config/opencode/rules/tokendiet.md` |

---

## Tools (16 total)

| # | Tool | Purpose |
|---|------|---------|
| 0 | `get_global_project` | ⚡ **One-call exploration**: bundles summary + tree + configs + entry points |
| 1 | `get_project_summary` | High-level overview: languages, frameworks, build system, structure |
| 2 | `get_directory_tree` | Visual tree with file types, sizes, entry points (.gitignore-aware) |
| 3 | `get_file_overview` | Symbol signatures (exports, classes, functions) — no implementation |
| 4 | `get_module_graph` | Import/export dependency graph, hubs, cycles |
| 5 | `search_symbols` | Find symbols by name across the project |
| 6 | `get_config_digest` | Summarized config files (package.json, tsconfig, Cargo.toml, etc.) |
| 7 | `get_entry_points` | Main files, CLI commands, API routes, test directories |
| 8 | `get_architecture_notes` | Architecture docs, ADRs, design notes — excerpts not full docs |
| 9 | `refresh_index` | Force full re-index after major changes |
| 10 | `find_dead_code` | Detect unused exports and files with no incoming imports |
| 11 | `get_symbol_body` | 🎯 Extract only the implementation body & doc of a specific function/class |
| 12 | `get_type_definitions` | 🧬 Extract and aggregate all types, interfaces, structs, and schemas |
| 13 | `get_symbol_references` | 🔍 Find all usages and references of a symbol across the codebase |
| 14 | `get_changed_symbols` | 📝 Semantic Git diff: added, modified, and removed symbols per file |
| 15 | `get_folded_file` | ✂️ File outline with folded implementation bodies ({ /* ... N lines */ }) |

## Agent Usage Workflow

When an AI agent explores and works on a project, it should call tools in this order:

```
0. get_global_project      ← ⚡ ALWAYS FIRST. One call = summary + tree + configs + entry points
1. search_symbols          ← Find specific code by name
2. get_file_overview       ← Understand file structure & exports (signatures only)
3. get_type_definitions    ← Inspect shared interfaces, types, and data models
4. get_symbol_body         ← Read ONLY the function/class implementation needed
5. get_symbol_references   ← Check who calls or depends on a symbol
6. get_module_graph        ← Trace project-wide module dependencies
7. get_folded_file         ← View full file skeleton with collapsed implementations
8. get_changed_symbols     ← Review semantic git changes before commit
9. find_dead_code          ← Detect unused exports and dead files
10. refresh_index          ← Re-index after major changes
```

See [SKILL.md](./SKILL.md) for the full agent instruction manual.

## How It Works

1. **Walker** scans the project respecting `.gitignore` (via the `ignore` package)
2. **Parsers** extract symbols and structure using regex (TypeScript/JS, Python, Go, Rust supported)
3. **SQLite cache** persists parsed results in `~/Library/Caches/tokendiet/<hash>.db`
4. **Tools** query the cache and return compact JSON optimized for AI consumption

## Token Savings

| Task | Without TokenDiet | With TokenDiet | Savings |
|------|-------------------|----------------|---------|
| Understand project structure (4 calls) | ~5,000 tokens (read configs + explore dirs) | ~2,000 tokens (summary + tree + configs + entry points) | **60%** |
| Understand project structure (1 call) | ~5,000 tokens (read configs + explore dirs) | ~800 tokens (get_global_project) | **84%** |
| Understand a file | ~3,000 tokens (read full file) | ~300 tokens (file_overview) | **90%** |
| Read a specific function / method | ~3,000-8,000 tokens (read whole file) | ~200 tokens (get_symbol_body) | **95%** |
| Extract types / schemas across project | ~6,000 tokens (read multiple type files) | ~500 tokens (get_type_definitions) | **92%** |
| Trace symbol usages / references | ~8,000 tokens (multiple grep + reads) | ~400 tokens (get_symbol_references) | **95%** |
| Inspect Git changes | ~4,000 tokens (raw git diff) | ~400 tokens (get_changed_symbols) | **90%** |
| View file outline with code folded | ~3,000 tokens (read full file) | ~500 tokens (get_folded_file) | **83%** |
| Find where X is defined | ~5,000 tokens (grep + read files) | ~300 tokens (search_symbols + file_overview) | **94%** |
| Trace dependencies | ~10,000 tokens (follow imports manually) | ~800 tokens (module_graph) | **92%** |
| Find dead code | ~15,000 tokens (grep + manually trace every import) | ~500 tokens (find_dead_code) | **97%** |

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `TOKENDIET_CACHE_DIR` | `~/Library/Caches/tokendiet` | Cache directory |
| `TOKENDIET_MAX_TOKENS` | `3000` | Max tokens per response |
| `TOKENDIET_MAX_FILES` | `20000` | Max files to index |
| `TOKENDIET_DISABLE_TREE_SITTER` | `0` | Set to `1` for regex-only parsing |

## Development

```bash
npm install
npm run dev        # Run with tsx (hot reload)
npm run build      # Build with tsup + bundle embedded skill
npm test           # Run tests
```

## License

MIT

## Author

[Theorhd](https://github.com/Theorhd)