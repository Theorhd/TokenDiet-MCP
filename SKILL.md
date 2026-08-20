---
name: tokendiet-mcp
description: Explore a codebase architecture without reading every file. Use when you need to understand a project's structure, find symbols, trace dependencies, or onboard to unfamiliar code — save 70-90% tokens vs reading files directly.
---

# TokenDiet — Codebase Exploration Without Reading Every File

You have access to the **TokenDiet MCP server** (`tokendiet`), which provides 19 tools that give you a structured, token-efficient understanding and manipulation of any codebase.

**Core principle:** Never read whole source files directly when TokenDiet can give you the architecture-level answer or extract the exact function body you need. Read full files ONLY when making multi-line edits.

---

## When to Use TokenDiet

Use TokenDiet when you need to answer questions like:
- "What is this project and how is it organized?" → `get_global_project` (single call — bundles the 4 exploration tools)
- "What does this project do?" → `get_project_summary` (or use `get_global_project`)
- "What packages/workspaces exist in this monorepo?" → `get_workspaces`
- "Where is the code for feature X?" → `search_symbols` → `get_file_overview`
- "What does this specific function/class do?" → `get_symbol_body` (NOT reading the whole file!)
- "What data types, interfaces or schemas exist?" → `get_type_definitions`
- "Who calls or imports this function/class?" → `get_symbol_references`
- "What files and tests break if I modify this file?" → `get_impact_analysis`
- "How are things organized?" → `get_directory_tree`
- "What depends on what?" → `get_module_graph`
- "What changed in git recently?" → `get_changed_symbols`
- "Can I see a high-level semantic diff with impact score?" → `get_diff_summary`
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
5. get_workspaces          ← Monorepo packages & topology (pnpm, turbo, npm/yarn, lerna, cargo, go.work).
```

### Deep-Dive & Implementation Workflow

```
6. search_symbols          ← Find where something is defined.
7. get_file_overview       ← See what a file exports (signatures only).
8. get_type_definitions    ← Aggregate all interfaces, types, structs, and schemas.
9. get_symbol_body         ← Extract ONLY the targeted function/class body & doc.
10. get_symbol_references  ← Trace all usages and imports of a symbol.
11. get_impact_analysis    ← Reverse dependency explosion & impacted test suites.
12. get_module_graph       ← Trace dependencies between modules (with Tarjan SCC cycles).
13. get_folded_file        ← Inspect full file outline with folded implementations.
14. get_architecture_notes ← Read design docs if they exist.
```

### Git & Maintenance Workflow

```
15. get_changed_symbols    ← Review added, modified, deleted symbols in git diff.
16. get_diff_summary       ← Semantic summary with before/after signature diff and blast radius.
17. find_dead_code         ← Find exported symbols and files that nothing imports.
18. refresh_index          ← Incremental/full re-index of cache.
```

---

## Detailed Tool Usage

### 0. `get_global_project` — The ONLY First Call You Need

```json
get_global_project({})
get_global_project({ "root": "/path/to/project" })
get_global_project({ "refresh": true, "depth": 5 })
```

---

### 11. `get_impact_analysis` — Blast Radius & Dependent Tests

```json
get_impact_analysis({ "path": "src/core/cache.ts" })
get_impact_analysis({ "path": "src/parsers/typescript.ts", "maxDepth": 3 })
```

**Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `path` | *required* | Target file or module path to analyze impact for |
| `maxDepth` | `5` | Maximum transitive dependency depth |
| `root` | cwd | Project root directory |

**What you get:**
- `directDependents` — Files directly importing the target
- `indirectDependents` — Transitive downstream files with depth
- `impactedTests` — Test files covering the component
- `totalImpactedFiles` — Total downstream count
- `blastRadius` — `low` | `medium` | `high` | `critical`

---

### 16. `get_diff_summary` — Semantic Diff with Blast Radius

```json
get_diff_summary({})
get_diff_summary({ "base": "main" })
get_diff_summary({ "stagedOnly": true })
```

---

### 19. `get_workspaces` — Monorepo Architecture Detector

```json
get_workspaces({})
get_workspaces({ "root": "/path/to/monorepo" })
```

**Auto-detected monorepo managers:** `pnpm-workspace.yaml`, `package.json:workspaces`, `turbo.json`, `lerna.json`, `Cargo.toml [workspace]`, `go.work`.

---

## Cache Behavior

TokenDiet caches parsed results per project in `~/Library/Caches/tokendiet/<hash>.db` (macOS) or the equivalent cache directory on other platforms. The cache uses incremental mtime/size checks to skip unchanged files.

---

## Precision in Results

| Value | Meaning | Action |
|-------|---------|--------|
| `"full"` | Parsed with Web-Tree-Sitter AST — signatures and line ranges are exact | Trust the output |
| `"approx"` | Parsed with regex fallback — signatures may be approximate | Inspect directly if 100% exact types required |

Tree-sitter WASM grammars are automatically lazy-loaded for TypeScript, TSX, JavaScript, Python, Go, Rust, Java, C#, Ruby, and PHP.
