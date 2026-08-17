# TokenDiet MCP

**Token-efficient codebase exploration for AI agents.** Save 70-90% of tokens when an AI needs to understand a project's architecture.

Instead of reading every file, the agent calls TokenDiet tools that return concise, structured, architecture-focused summaries.

## Installation

```bash
npm install -g tokendiet-mcp
```

Or run without installing:
```bash
npx tokendiet-mcp
```

**Requires Node.js >= 22.13** (for built-in SQLite).

## Claude Code Setup

```bash
# Global install
claude mcp add tokendiet -- tokendiet

# Or with npx (no global install)
claude mcp add tokendiet -- npx -y tokendiet-mcp
```

## Tools (11 total)

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

## Agent Usage Workflow

When an AI agent explores a new project, it should call tools in this order:

```
0. get_global_project      ← ⚡ ALWAYS FIRST. One call = summary + tree + configs + entry points
1. search_symbols          ← Find specific code
2. get_file_overview       ← Understand a file
3. get_module_graph        ← Trace dependencies
4. get_architecture_notes  ← Design docs
5. find_dead_code          ← Detect unused code
6. refresh_index           ← Re-index after changes
```

See [SKILL.md](./SKILL.md) for the full agent instruction manual.

## How It Works

1. **Walker** scans the project respecting `.gitignore` (via the `ignore` package)
2. **Parsers** extract symbols using regex (TypeScript/JS, Python, Go, Rust supported; tree-sitter WASM as tier-1, regex as fallback)
3. **SQLite cache** persists parsed results in `~/Library/Caches/tokendiet/<hash>.db`
4. **Tools** query the cache and return compact JSON optimized for AI consumption

## Token Savings

| Task | Without TokenDiet | With TokenDiet | Savings |
|------|-------------------|----------------|---------|
| Understand project structure (4 calls) | ~5,000 tokens (read configs + explore dirs) | ~2,000 tokens (summary + tree + configs + entry points) | **60%** |
| Understand project structure (1 call) | ~5,000 tokens (read configs + explore dirs) | ~800 tokens (get_global_project) | **84%** |
| Understand a file | ~3,000 tokens (read full file) | ~300 tokens (file_overview) | **90%** |
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
npm run build      # Build with tsup
npm test           # Run tests
```

## License

MIT

## Author

[Theorhd](https://github.com/Theorhd)