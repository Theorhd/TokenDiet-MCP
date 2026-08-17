---
name: tokendiet-mcp
description: Explore a codebase architecture without reading every file. Use when you need to understand a project's structure, find symbols, trace dependencies, or onboard to unfamiliar code — save 70-90% tokens vs reading files directly.
---

# TokenDiet — Codebase Exploration Without Reading Every File

You have access to the **TokenDiet MCP server** (`tokendiet`), which provides 16 tools that give you a structured, token-efficient understanding and manipulation of any codebase.

**Core principle:** Never read whole source files directly when TokenDiet can give you the architecture-level answer or extract the exact function body you need. Read full files ONLY when making multi-line edits.

---

## When to Use TokenDiet

Use TokenDiet when you need to answer questions like:
- "What is this project and how is it organized?" → `get_global_project` (single call — bundles the 4 exploration tools)
- "What does this project do?" → `get_project_summary` (or use `get_global_project`)
- "Where is the code for feature X?" → `search_symbols` → `get_file_overview`
- "What does this specific function/class do?" → `get_symbol_body` (NOT reading the whole file!)
- "What data types, interfaces or schemas exist?" → `get_type_definitions`
- "Who calls or imports this function/class?" → `get_symbol_references`
- "How are things organized?" → `get_directory_tree`
- "What depends on what?" → `get_module_graph`
- "What changed in git recently?" → `get_changed_symbols`
- "Can I see the full file outline with code folded?" → `get_folded_file`
- "How do I run this?" → `get_entry_points`
- "What does this config do?" → `get_config_digest`
- "What's the architecture philosophy?" → `get_architecture_notes`
- "What's in this file?" → `get_file_overview` (signatures only)
- "Is this code actually used?" → `find_dead_code`

**Do NOT** use `Read` or `cat` a source file to understand its role in the architecture or read a function. Use TokenDiet tools instead.

---

## Tool Reference

### ⚡ Quick Start (ONE call instead of four)

```
0. get_global_project      ← CALL THIS FIRST. Bundles tools 1-4 in a single call.
                              Returns summary + tree + configs + entry points.
                              Saves 4 round-trips and ~60% tokens vs calling individually.
```

### Exploration Workflow (individual calls — use get_global_project instead)

```
1. get_project_summary     ← High-level project picture.
2. get_directory_tree      ← Understand folder structure.
3. get_config_digest       ← Frameworks, dependencies, build system.
4. get_entry_points        ← How to start/run/deploy.
```

### Deep-Dive & Implementation Workflow

```
5. search_symbols          ← Find where something is defined.
6. get_file_overview       ← See what a file exports (signatures only).
7. get_type_definitions    ← Aggregate all interfaces, types, structs, and schemas.
8. get_symbol_body         ← Extract ONLY the targeted function/class body & doc.
9. get_symbol_references   ← Trace all usages and imports of a symbol.
10. get_module_graph       ← Trace dependencies between modules.
11. get_folded_file        ← Inspect full file outline with folded implementations.
12. get_architecture_notes ← Read design docs if they exist.
```

### Git & Maintenance Workflow

```
13. get_changed_symbols    ← Review added, modified, deleted symbols in git diff.
14. find_dead_code         ← Find exported symbols and files that nothing imports.
15. refresh_index          ← After large refactors or if cache feels stale.
```

---

## Detailed Tool Usage

### 0. `get_global_project` — The ONLY First Call You Need

```json
// Basic — everything you need in one call
get_global_project({})

// Specific project
get_global_project({ "root": "/path/to/project" })

// Force re-index + deeper tree
get_global_project({ "refresh": true, "depth": 5 })
```

**Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `root` | cwd | Project root directory |
| `refresh` | `false` | Force full re-index before analysis |
| `depth` | `3` | Directory tree depth (1–8) |

**What you get (all in one response):**
- `summary` — ProjectSummary: name, type, languages, frameworks, build system, stats
- `tree` — Directory tree in compact text format
- `configs` — Parsed config files (package.json, tsconfig, Cargo.toml, etc.)
- `entryPoints` — Main files, CLI commands
- `routes` — API routes detected (Express, Fastify, FastAPI, Flask, Gin)
- `cliCommands` — CLI binaries and npm scripts
- `elapsedMs` — Total time spent

**This replaces calling these 4 tools individually:**
```
❌ OLD: get_project_summary → get_directory_tree → get_config_digest → get_entry_points
✅ NEW: get_global_project
```

**Token savings:** ~800 tokens vs ~2,000 tokens for the 4 individual calls (**60% savings**). Also saves 4 round-trips to the MCP server.

---

### 1. `get_project_summary` — The First Call (legacy)

```json
// Basic — auto-detects root
get_project_summary({})

// Specific project
get_project_summary({ "root": "/path/to/project" })

// Force re-index after large changes
get_project_summary({ "refresh": true })
```

**What you get:** Project name, type (app/library/monorepo), languages with percentages, frameworks detected, build system, package manager, test framework, top-level directory roles, file counts.

**Token savings:** ~100-200 tokens vs reading package.json + tsconfig + exploring manually (~2000+ tokens).

---

### 2. `get_directory_tree` — Visual Structure

```json
// Default: depth 3, text format, tests included
get_directory_tree({})

// Deeper exploration (max depth: 8)
get_directory_tree({ "depth": 5 })

// Only directories (even more compact)
get_directory_tree({ "dirsOnly": true })

// Exclude test files/directories
get_directory_tree({ "includeTests": false })

// JSON output (for programmatic use)
get_directory_tree({ "format": "json" })

// Limit entries returned (default: 200)
get_directory_tree({ "maxEntries": 100 })
```

**Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `root` | cwd | Project root directory |
| `depth` | `3` | Maximum depth to traverse (1–8) |
| `dirsOnly` | `false` | Only show directories |
| `includeTests` | `true` | Include test files and directories |
| `maxEntries` | `200` | Maximum number of entries to return |
| `format` | `"text"` | Output format: `"text"` (token-efficient) or `"json"` |

**Output format:** Text tree with `[lang size LOC]` per file, `*` marks entry points. Truncated output shows a `(_truncated: max entries reached)` footer.

**Token savings:** ~300-500 tokens vs listing directories manually (~3000+ tokens).

---

### 3. `get_file_overview` — File Signature (NOT File Contents)

```json
// Get all exported symbols with signatures
get_file_overview({ "path": "src/utils/api.ts" })

// Specific project root + file
get_file_overview({ "path": "src/hooks/useAuth.ts", "root": "/path/to/project" })

// Just names (ultra-compact)
get_file_overview({ "path": "src/hooks/useAuth.ts", "detail": "names" })

// With first few lines of implementation
get_file_overview({ "path": "src/core/cache.ts", "detail": "bodies" })

// Limit results (default: 100)
get_file_overview({ "path": "src/components/Button.tsx", "maxSymbols": 20 })
```

**Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `path` | *required* | Path to the file, relative to project root or absolute |
| `root` | cwd | Project root directory |
| `detail` | `"signatures"` | `"signatures"` / `"names"` / `"bodies"` (first few lines) |
| `maxSymbols` | `100` | Maximum symbols to return |

**What you get:** Language, purpose, imports (grouped: external/internal), exports with signatures, classes/interfaces/types, LOC, last modified. **No implementation code.**

**About `precision`:** Each result includes a `precision` field — `"exact"` means tree-sitter parsed the file, `"approx"` means regex-based parsing. When precision is `"approx"`, consider reading the file directly if you need 100% accurate signatures.

**Token savings:** ~200-500 tokens vs reading the file (~2000-5000 tokens). **This is the biggest saver.**

---

### 4. `get_module_graph` — Dependency Map

```json
// Whole-project view (aggregated by directory — RECOMMENDED)
get_module_graph({})

// Focus on one module
get_module_graph({
  "module": "src/parsers/",
  "depth": 2,
  "direction": "both"
})

// Detailed per-file (NOT recommended for import tracing — edges may be sparse)
get_module_graph({ "aggregate": false })

// Limit edges returned (default: 200)
get_module_graph({ "maxEdges": 100 })
```

**Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `root` | cwd | Project root directory |
| `module` | — | Focus on a specific file or directory path |
| `depth` | `2` | How deep to traverse dependencies |
| `direction` | `"out"` | `"out"` (what this imports), `"in"` (what imports this), `"both"` |
| `maxEdges` | `200` | Maximum edges to return |
| `aggregate` | `true` | Aggregate by directory (recommended for whole-project view) |

**What you get:** Nodes (modules with size/export count), edges (imports), hubs (high in-degree — architecture-critical), cycles, external dependency counts.

**Important:** When `aggregate: false`, edges may be empty for TypeScript projects because imports use `.js` extensions while source files are `.ts`. Prefer `aggregate: true` (the default) for dependency analysis. Use per-file mode only for quick node metadata (size, language, export count).

**Token savings:** ~500-1000 tokens vs tracing imports manually (~10000+ tokens).

---

### 5. `search_symbols` — Find Anything by Name

```json
// Find all functions named "parse"
search_symbols({ "query": "parse" })

// Find React components (substring match)
search_symbols({ "query": "Button", "kind": "function" })

// Filter by symbol kind
search_symbols({ "query": "cache", "kind": "class" })

// Find in specific language
search_symbols({ "query": "Handler", "language": "go" })

// Find in specific directory (filePattern supports * globs)
search_symbols({ "query": "config", "filePattern": "src/core/*" })

// All options combined
search_symbols({
  "query": "Service",
  "kind": "class",
  "language": "typescript",
  "filePattern": "src/**",
  "limit": 20
})
```

**Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `root` | cwd | Project root directory |
| `query` | *required* | **Substring match** against symbol names (case-insensitive). NOT a glob — `"get*"` looks for literal `get*`, not names starting with "get". |
| `kind` | `"all"` | Filter by symbol kind: `"function"`, `"class"`, `"interface"`, `"type"`, `"enum"`, `"const"`, `"struct"`, `"trait"`, `"method"`, `"all"` |
| `language` | — | Filter by language: `"typescript"`, `"javascript"`, `"python"`, `"go"`, `"rust"`, `"java"`, `"ruby"` |
| `filePattern` | — | Filter by file pattern. Supports `*` glob (e.g., `"src/**"`, `"*.ts"`) |
| `limit` | `30` | Maximum results |

**Matching behavior:**
- **`query`** is a plain **substring/contains** match (case-insensitive). Searching for `"parse"` matches `parseFile`, `parseConfig`, `genericParse`, etc. The `*` character in `query` is treated literally — do NOT use it as a wildcard.
- **`filePattern`** DOES support `*` as a glob wildcard (converted to `.*` regex). Use `"src/**"` to match all files under `src/`, or `"*.ts"` for TypeScript files only.

**Token savings:** ~200-300 tokens vs grep/Read loop (~5000+ tokens).

---

### 6. `get_config_digest` — Configuration at a Glance

```json
// Auto-detect all config files
get_config_digest({})

// Specific config file only
get_config_digest({ "path": "tsconfig.json" })

// In a specific project
get_config_digest({ "root": "/path/to/project" })
```

**Auto-detected configs:** `package.json`, `tsconfig.json`/`jsconfig.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements.txt`, `Pipfile`, `Gemfile`, `.ruby-version`, `pom.xml`, `build.gradle`/`.kts`, `Dockerfile`, `docker-compose.yml`/`.yaml`, `vite.config.*`, `webpack.config.js`, `next.config.*`, `.eslintrc.*`/`eslint.config.*`, `.prettierrc`/`prettier.config.js`, `biome.json`, `.github/workflows/`.

For unrecognized JSON files, returns top-level keys. TOML files (Cargo, pyproject) use basic regex extraction — not a full TOML parser.

**Token savings:** ~300-500 tokens vs reading each config file (~3000+ tokens).

---

### 7. `get_entry_points` — How to Run This Thing

```json
// Auto-detect entry points
get_entry_points({})

// In a specific project
get_entry_points({ "root": "/path/to/project" })
```

**What you get:**
- Main entry files (with source: `package.json:main`, `convention: index`, etc.)
- CLI commands/binaries (from `package.json:bin` and npm scripts)
- API routes (Express/Fastify/Hono/FastAPI/Flask/Gin — detected via framework heuristics)
- Test directories with file counts

**Token savings:** ~200-300 tokens vs searching package.json scripts + convention hunting (~2000+ tokens).

---

### 8. `get_architecture_notes` — Design Intent

```json
// Default: 800 words max per source doc
get_architecture_notes({})

// More context
get_architecture_notes({ "maxWords": 2000 })

// In a specific project
get_architecture_notes({ "root": "/path/to/project" })
```

**Searches these paths** (in order): `ARCHITECTURE.md`, `docs/architecture.md`, `docs/architecture/`, `docs/adr/`, `design/`, `docs/design/`, `CONTRIBUTING.md`. Falls back to `README.md` if none found.

**What you get:**
- `found` — list of discovered doc paths
- `headings` — all `h1`–`h3` headings across docs
- `sources` — per-doc excerpts truncated to `maxWords`
- `keyConcepts` — detected architectural patterns and technologies (MVC, REST, GraphQL, CQRS, Microservices, Hexagonal, React, Docker, PostgreSQL, etc.)

**Token savings:** Returns excerpts and headings, not full docs. ~500 tokens vs reading architecture docs (~5000+ tokens).

---

### 9. `refresh_index` — Keep Fresh

```json
refresh_index({})

// In a specific project
refresh_index({ "root": "/path/to/project" })
```

Call after major refactors, branch switches, or when cached data feels stale. Re-indexes all files and returns `{ reindexed: N, removed: N, elapsedMs: N }`.

---

### 10. `find_dead_code` — Detect Unused Code

```json
// Default: exclude tests, medium confidence threshold
find_dead_code({})

// Specific project
find_dead_code({ "root": "/path/to/project" })

// High-confidence only (exports from files with zero incoming imports)
find_dead_code({ "minConfidence": "high" })

// Include test files in analysis
find_dead_code({ "includeTests": true })

// Skip generated code
find_dead_code({ "ignorePatterns": ["src/generated/**", "*.gen.ts"] })
```

**Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `root` | cwd | Project root directory |
| `includeTests` | `false` | Include test files in the analysis |
| `ignorePatterns` | — | Glob patterns for files to skip (e.g., `"src/generated/**"`) |
| `minConfidence` | `"medium"` | Minimum confidence: `"high"` (exports from files with zero incoming imports — very safe to delete) or `"medium"` (also returns exports whose names are never imported directly — may include namespace-imported symbols) |

**What you get:**
- `unusedExports[]` — each item: `file`, `symbol`, `kind` (function/class/interface etc.), `line`, `confidence` (`"high"` or `"medium"`), `reason`
- `unusedFiles[]` — files never imported by any other file (excludes entry points). Confidence: `"medium"`
- `summary` — totals and `cacheUsed` flag

**Confidence levels:**
| Level | Meaning | Action |
|-------|---------|--------|
| `high` | Export from a file with zero incoming imports, or individual symbol never imported by name | Safe to delete after quick verification |
| `medium` | File imported (possibly via namespace/default import) but this specific name is never used directly | Investigate before deleting — may be used via `import * as X` |

**Limitations:**
- Only detects **cross-module** unused code (exports never imported elsewhere). Does NOT detect symbols unused within their own file.
- TypeScript imports using `.js` extensions are correctly resolved to `.ts` source files.
- Entry points (main files, CLI scripts, tests) are never flagged as unused files.
- Side-effect imports (`import './side-effects'`) keep their target files alive.
- Results are **candidates** — always verify before deleting.

**Token savings:** ~500-1000 tokens vs manually tracing imports across the project (~10,000+ tokens).

---

### 11. `get_symbol_body` — Surgical Function / Class Extraction

```json
// Extract a function's implementation without reading the whole file
get_symbol_body({ "path": "src/core/cache.ts", "symbol": "upsertFile" })

// Specific project and limit lines
get_symbol_body({
  "path": "src/server.ts",
  "symbol": "createServer",
  "maxLines": 100,
  "root": "/path/to/project"
})
```

**Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `path` | *required* | Path to the file containing the symbol |
| `symbol` | *required* | Exact name of the symbol (function, method, class, struct) to extract |
| `maxLines` | `150` | Maximum number of implementation lines to return |
| `root` | cwd | Project root directory |

**What you get:** Exact line range (`line`, `endLine`), symbol kind, signature, leading doc comment, and the exact implementation body without the surrounding file.

**Token savings:** ~200 tokens vs reading a 500-line file (~3,000-8,000 tokens). **95% token savings.**

---

### 12. `get_type_definitions` — Fast Types & Schemas Digest

```json
// Get all types/interfaces across the whole project
get_type_definitions({})

// Filter to a specific types file or module directory
get_type_definitions({ "path": "src/types/index.ts" })

// In a specific project with custom limit
get_type_definitions({ "path": "src/models/", "limit": 40 })
```

**Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `path` | — | Target file or directory prefix to filter types |
| `limit` | `50` | Maximum number of type definitions to return |
| `root` | cwd | Project root directory |

**What you get:** List of `interfaces`, `types`, `enums`, `structs`, and `traits` with signatures, line numbers, and doc comments without implementation code.

**Token savings:** ~500 tokens vs reading all type definition files (~6,000 tokens). **92% token savings.**

---

### 13. `get_symbol_references` — Symbol Usages & Callers

```json
// Find where CacheManager is used across the codebase
get_symbol_references({ "symbol": "CacheManager" })

// In a specific project with limit
get_symbol_references({ "symbol": "parseFile", "limit": 20 })
```

**Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `symbol` | *required* | Symbol name to find references for |
| `path` | — | Target file where the symbol is defined (optional) |
| `limit` | `30` | Maximum references to return |
| `root` | cwd | Project root directory |

**What you get:** All occurrences with file, line number, `isImport` boolean, and a compact 1-line preview.

**Token savings:** ~400 tokens vs grep + reading every referencing file (~8,000 tokens). **95% token savings.**

---

### 14. `get_changed_symbols` — Semantic Git Diff

```json
// Check uncommitted changes in current working tree
get_changed_symbols({})

// Only staged changes
get_changed_symbols({ "stagedOnly": true })

// Compare against main branch or previous commit
get_changed_symbols({ "base": "main" })
get_changed_symbols({ "base": "HEAD~1" })
```

**Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `stagedOnly` | `false` | Only inspect staged git changes |
| `base` | — | Git base reference to diff against (e.g. `"main"`, `"HEAD~1"`) |
| `root` | cwd | Project root directory |

**What you get:** Current branch, list of changed files with status (`modified`, `added`, `deleted`), and the exact list of `addedSymbols`, `modifiedSymbols`, and `removedSymbols` per file.

**Token savings:** ~400 tokens vs raw git diff (~4,000 tokens). **90% token savings.**

---

### 15. `get_folded_file` — Code Outline with Collapsed Bodies

```json
// View file skeleton with folded function bodies
get_folded_file({ "path": "src/server.ts" })

// Keep specific functions unfolded while folding the rest
get_folded_file({
  "path": "src/server.ts",
  "unfoldSymbols": ["startServer"]
})
```

**Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `path` | *required* | Path to the file to fold |
| `unfoldSymbols` | `[]` | List of symbol names to keep expanded |
| `root` | cwd | Project root directory |

**What you get:** Complete file structure (imports, type definitions, exports, signatures) with inner implementations replaced by `{ /* ... N lines folded */ }`.

**Token savings:** ~500 tokens vs reading a 500-line file (~3,000 tokens). **83% token savings.**

---

## Anti-Patterns (DO NOT DO THESE)

| ❌ Anti-Pattern | ✅ Correct |
|-----------------|-----------|
| Calling 4 exploration tools one by one on a new project | `get_global_project({})` — one call, all the context |
| Reading a 500-line file to see 1 function implementation | `get_symbol_body({ path: "...", symbol: "..." })` |
| Reading multiple files to collect types and interfaces | `get_type_definitions({ path: "..." })` |
| Running `grep` + reading 5 files to find where a function is called | `get_symbol_references({ symbol: "..." })` |
| Running `git diff` with hundreds of raw lines | `get_changed_symbols({})` |
| `Read src/components/Button.tsx` to understand what it does | `get_file_overview({ path: "src/components/Button.tsx" })` |
| `grep -r "function parse" src/` | `search_symbols({ query: "parse", kind: "function" })` |
| `cat package.json` then `cat tsconfig.json` then `cat vite.config.ts` | `get_config_digest({})` |
| Manually tracing imports across 10 files | `get_module_graph({ module: "src/core/" })` |
| `ls -R` to understand directory structure | `get_directory_tree({})` |
| Reading README + ARCHITECTURE + ADRs | `get_architecture_notes({})` |
| Using `search_symbols({ query: "get*" })` expecting a prefix/glob match | Use `search_symbols({ query: "get" })` — it's a substring match |
| Manually checking if an export is used anywhere | `find_dead_code({})` |

---

## Decision Tree

```
Starting to explore a project?
  → get_global_project({})              ← ONE call replaces the 4 below
  OR (if you need fine-grained control):
  → get_project_summary({})
  → get_directory_tree({})
  → get_config_digest({})

Need to understand a specific file structure?
  → get_file_overview({ path: "..." })  ← signatures, imports, purpose
  → get_folded_file({ path: "..." })    ← full code skeleton with collapsed bodies

Need to inspect a specific function / class body?
  → get_symbol_body({ path: "...", symbol: "..." })  ← ONLY reads target lines!

Need to find interfaces, types or schemas?
  → get_type_definitions({ path: "..." })

Looking for where something is defined?
  → search_symbols({ query: "..." })    ← substring match, NOT glob
  → get_file_overview({ path: result.file })

Tracing where a symbol is called / imported?
  → get_symbol_references({ symbol: "..." })

Tracing how modules connect?
  → get_module_graph({})                ← aggregated mode (default)

Inspecting recent code changes?
  → get_changed_symbols({})             ← semantic diff without raw noise

Want to know how to run the project?
  → get_entry_points({})

Want to understand project philosophy/patterns?
  → get_architecture_notes({})

Just pulled/rebased and data seems off?
  → refresh_index({})

Want to find dead code / unused exports?
  → find_dead_code({})
  → Use minConfidence: "high" for safe-to-delete results
```

---

## Cache Behavior

TokenDiet caches parsed results per project in `~/Library/Caches/tokendiet/<hash>.db` (macOS) or the equivalent cache directory on other platforms. The cache persists across sessions. Files are invalidated by mtime — edits are detected automatically. Call `refresh_index({})` to force a full re-index.

**Important:** Always call `get_global_project({})` (or `get_project_summary({})`) first on a new project to populate the cache. Subsequent tool calls will be near-instant.

---

## Understanding `precision` in Results

Results from `get_file_overview`, `get_project_summary`, and `search_symbols` include a `precision` field:

| Value | Meaning | Action |
|-------|---------|--------|
| `"exact"` | Parsed with tree-sitter — signatures are reliable | Trust the output |
| `"approx"` | Parsed with regex — signatures may be incomplete | Read the file directly if you need 100% accuracy |

Tree-sitter is the default parser for supported languages. Regex fallback is used when tree-sitter WASM is unavailable or when `TOKENDIET_DISABLE_TREE_SITTER=1` is set.

---

## Token Budget

Set `TOKENDIET_MAX_TOKENS` env var to cap response sizes (default: `3000`). All tools respect this — if output would exceed the budget, results are truncated with an explicit `_truncated` marker so you know the answer is partial.

Additional env vars:

| Variable | Default | Description |
|----------|---------|-------------|
| `TOKENDIET_CACHE_DIR` | `~/Library/Caches/tokendiet` | Cache directory |
| `TOKENDIET_MAX_TOKENS` | `3000` | Max tokens per response |
| `TOKENDIET_MAX_FILES` | `20000` | Max files to index |
| `TOKENDIET_DISABLE_TREE_SITTER` | `0` | Set to `1` for regex-only parsing |

---

## Installation

```bash
npm install -g tokendiet-mcp
claude mcp add tokendiet -- tokendiet
```

Or without global install:

```bash
claude mcp add tokendiet -- npx -y tokendiet-mcp
```

**Requires Node.js >= 22.13** (for built-in SQLite).
