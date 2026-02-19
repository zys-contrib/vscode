# Agent Plugin Implementation Plan (Handoff)

## Objective
Implement dual support for Copilot-style and Claude-style agent plugins in VS Code chat, with modular discovery and a unified internal plugin service.

This document summarizes:
- what is already implemented,
- what design decisions were made,
- what remains to be built,
- and a concrete continuation plan for another agent.

---

## Current Status (Implemented)

### 1) Core service contracts scaffolded
**File:** `src/vs/workbench/contrib/chat/common/plugins/agentPluginService.ts`

Implemented:
- `IAgentPluginService` via `createDecorator('agentPluginService')`
- `IAgentPlugin` with:
  - `uri: URI`
  - `hooks: IObservable<readonly IAgentPluginHook[]>`
- `IAgentPluginHook` with:
  - `event: string`
  - `command: string`
- `IAgentPluginDiscovery` interface with:
  - `plugins: IObservable<readonly IAgentPlugin[]>`
  - `start(): void`
- `agentPluginDiscoveryRegistry` (MCP-inspired descriptor registry)

Notable refactor already completed:
- Removed `source`/`mode` from `IAgentPlugin` as redundant.
- Service-level source enablement logic was removed from `AgentPluginService` and moved into discovery implementations.

---

### 2) Service implementation scaffolded and discovery modularized
**File:** `src/vs/workbench/contrib/chat/common/plugins/agentPluginServiceImpl.ts`

Implemented:
- `AgentPluginService` that is source-agnostic:
  - instantiates all registered discoveries
  - starts each discovery
  - aggregates discovery observables
  - dedupes by plugin URI
  - deterministic sort by URI
- `WorkspaceAgentPluginDiscovery` base class:
  - internal per-discovery enablement handling via config observable
  - workspace folder-based candidate directory scan
  - manual plugin path support (see config below)
  - per-discovery `isPluginRoot(uri)` type check
  - `toPlugin(uri)` currently returns plugin shell with empty hooks observable

Implemented discovery types:
- `CopilotAgentPluginDiscovery`
  - search paths: `.copilot/plugins`, `.vscode/plugins`
  - root detection: `plugin.json`
  - enablement key: `chat.plugins.copilot.enabled` (default true)
- `ClaudeAgentPluginDiscovery`
  - search paths: `.claude/plugins`, `.vscode/plugins`
  - root detection: `.claude-plugin/plugin.json` OR any of:
    - `agents/`, `skills/`, `commands/`, `hooks.json`, `.mcp.json`, `.lsp.json`
  - enablement key: `chat.plugins.claude.enabled` (default false)

Manual path behavior implemented:
- `chat.plugins.paths` is read by base discovery class.
- Every path is treated as candidate plugin root if it resolves to a directory.
- Plugin type is inferred by each discovery via `isPluginRoot`, so the same manual path may be considered by either discovery depending on contents.

---

### 3) Configuration keys added
**File:** `src/vs/workbench/contrib/chat/common/constants.ts`

Added `ChatConfiguration` keys:
- `CopilotPluginsEnabled = 'chat.plugins.copilot.enabled'`
- `ClaudePluginsEnabled = 'chat.plugins.claude.enabled'`
- `PluginPaths = 'chat.plugins.paths'`

---

### 4) Configuration contribution and registration wiring added
**File:** `src/vs/workbench/contrib/chat/browser/chat.contribution.ts`

Added config schema entries:
- `chat.plugins.copilot.enabled` (boolean, default `true`, experimental)
- `chat.plugins.claude.enabled` (boolean, default `false`, experimental)
- `chat.plugins.paths` (string array, default `[]`, `ConfigurationScope.MACHINE`, experimental)

Added discovery registrations:
- `agentPluginDiscoveryRegistry.register(new SyncDescriptor(CopilotAgentPluginDiscovery))`
- `agentPluginDiscoveryRegistry.register(new SyncDescriptor(ClaudeAgentPluginDiscovery))`

Added singleton registration:
- `registerSingleton(IAgentPluginService, AgentPluginService, InstantiationType.Delayed)`

---

## Design Decisions Locked In

1. **Unified plugin model at this stage is intentionally minimal**
   - Only URI + hooks observable for now.
   - Component-level metadata parsing is deferred.

2. **AgentPluginService is intentionally generic**
   - No mode/source assumptions in service orchestration.
   - Discovery implementations own mode-specific behavior.

3. **Per-discovery enablement**
   - `CopilotAgentPluginDiscovery` and `ClaudeAgentPluginDiscovery` each gate themselves via their own config key.

4. **Manual plugin paths are global candidates**
   - Path list is shared by all discoveries.
   - Discovery type determined by each discovery’s `isPluginRoot` logic.

5. **Deterministic aggregation**
   - URI dedupe + stable sort in service.

---

## What Is Left (Overall)

## Phase 1: Normalize plugin metadata and structure (next recommended)
- Extend `IAgentPlugin` to include normalized metadata fields (minimal but useful):
  - plugin id/name
  - display name/description/version (if available)
  - manifest presence/mode info (if needed internally)
- Implement metadata loading in `toPlugin` (or dedicated loader):
  - Copilot: parse `plugin.json`
  - Claude: parse `.claude-plugin/plugin.json` if present, else infer from folder
- Add robust JSON parse/error handling with non-fatal skip behavior.

## Phase 2: Component discovery and parsing
- Discover component roots/files per plugin:
  - `agents/`, `skills/`, `commands/`, `hooks.json`, `.mcp.json`, `.lsp.json`
- Parse markdown frontmatter for agents/skills/commands.
- Populate plugin model with parsed components/hook data.
- Keep malformed components as soft-fail (skip component, continue plugin).

## Phase 3: Conflict semantics + namespacing behavior
- Implement mode-specific duplicate behavior:
  - Copilot: first-wins + warning
  - Claude: allow duplicates via namespace
- Decide where conflict resolution belongs (service-level merge vs registry-level registrar).

## Phase 4: Sandbox/validation hardening
- Validate paths used by plugin configs:
  - no absolute path escapes
  - no `../` traversal outside plugin root
- Consider symlink escape protections.

## Phase 5: Activation/runtime integration
- Hook execution model (controlled subprocess)
- MCP/LSP process integration (if required in this project scope)
- Lifecycle dispatch (`onStart`, `onExit`, etc.)

## Phase 6: Test coverage
- Unit tests for:
  - mode detection
  - manual path handling
  - enable/disable config behavior
  - dedupe/sort determinism
  - malformed manifest/component handling

---

## Immediate TODOs for Next Agent (Concrete)

1. **Introduce plugin metadata type(s)** in `agentPluginService.ts`.
2. **Add plugin loader helper(s)** in `agentPluginServiceImpl.ts` to parse manifests safely.
3. **Update `toPlugin`** to include parsed metadata (or to return richer object).
4. **Add logging hooks** (trace/warn) for skip/failure paths.
5. **Add tests** under the appropriate chat common test suite for discovery + manual paths.

---

## Known External/Unrelated Build Noise
Build/watch output in this workspace has shown unrelated existing failures outside this implementation area (for example parse/transpile errors in unrelated files). Treat these as pre-existing unless reproduced directly from plugin-service changes.

For validation of this feature work, rely on:
- targeted diagnostics for touched files,
- and `VS Code - Build` watch output to ensure no new plugin-service-related compile errors.

---

## Touched Files (so far)
- `src/vs/workbench/contrib/chat/common/plugins/agentPluginService.ts`
- `src/vs/workbench/contrib/chat/common/plugins/agentPluginServiceImpl.ts`
- `src/vs/workbench/contrib/chat/common/constants.ts`
- `src/vs/workbench/contrib/chat/browser/chat.contribution.ts`

---

## Quick Continuation Prompt (for another agent)
“Continue from PLAN.md. Implement Phase 1 by extending IAgentPlugin with normalized metadata and parsing plugin manifests (`plugin.json` and optional `.claude-plugin/plugin.json`) with non-fatal error handling. Keep AgentPluginService source-agnostic and preserve per-discovery enablement/manual path behavior.”
