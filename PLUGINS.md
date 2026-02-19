```markdown
# Dual Plugin Support Implementation Guide
## Supporting GitHub Copilot CLI and Claude Code Plugins

This document provides complete technical guidance for implementing plugin support compatible with:

- **GitHub Copilot CLI**
- **Claude Code CLI**

It is written for an implementation agent that must:

1. Detect plugin format
2. Load plugin components
3. Validate structure
4. Resolve differences between systems
5. Execute components consistently
6. Optionally generate dual-compatible plugin packages

---

# 1. Core Architectural Model

Both systems treat a plugin as:

> A self-contained directory containing structured Markdown components and optional JSON configuration files.

Supported root-level components:

```

plugin.json
agents/
skills/
commands/
hooks.json
.mcp.json
.lsp.json
.claude-plugin/plugin.json

```

All functional content must live inside the plugin directory.

---

# 2. Detection Rules

When loading a plugin directory:

## 2.1 Determine Target Mode

### Copilot Mode Detection
A plugin is Copilot-compatible if:
- `plugin.json` exists at root

Copilot requires this file.

### Claude Mode Detection
A plugin is Claude-compatible if:
- `.claude-plugin/plugin.json` exists
OR
- Any of `agents/`, `skills/`, `commands/`, `hooks.json`, `.mcp.json`, `.lsp.json` exists

Claude does **not** require a manifest.

---

# 3. Manifest Handling

## 3.1 Copilot CLI Manifest (Required)

Location:
```

plugin.json

````

### Required Fields
```json
{
  "name": "kebab-case-id"
}
````

### Common Optional Fields

* version
* description
* author
* homepage
* repository
* license
* keywords
* agents
* skills
* commands
* hooks
* mcpServers
* lspServers

If component paths are omitted, defaults should be assumed:

* agents → `agents/`
* skills → `skills/`
* commands → `commands/`
* hooks → `hooks.json`
* mcpServers → `.mcp.json`
* lspServers → `.lsp.json`

---

## 3.2 Claude Manifest (Optional)

Location:

```
.claude-plugin/plugin.json
```

Supports same metadata fields as Copilot, plus:

* `outputStyles`

If missing, Claude auto-discovers components.

---

## 3.3 Unified Manifest Strategy

For maximum compatibility:

* Always generate a root `plugin.json` (Copilot requirement)
* Mirror metadata into `.claude-plugin/plugin.json`
* Ignore `outputStyles` when running in Copilot mode

---

# 4. Component Loading Rules

## 4.1 Agents (`agents/`)

### Format

Markdown files with YAML frontmatter:

```markdown
---
name: my-agent
description: Short description
model: optional-model
---

System prompt content...
```

### Claude Behavior

* Namespaced as: `plugin-name:agent-name`
* All agents coexist via namespacing

### Copilot Behavior

* First-found-wins on duplicate agent names
* Later duplicates are silently ignored

### Implementation Rules

* Extract YAML frontmatter
* Validate `name`
* Namespace internally as:

  ```
  <plugin-name>/<agent-name>
  ```
* Provide collision detection warnings in Copilot mode

---

## 4.2 Skills (`skills/`)

### Format

Markdown with frontmatter:

```markdown
---
name: my-skill
description: Description
---

Instructions...
```

### Behavior Differences

* Claude namespaces
* Copilot uses precedence resolution

Implementation identical to agents.

---

## 4.3 Commands (`commands/`)

### Format

Markdown with frontmatter:

```markdown
---
name: hello
description: Say hello
---

Prompt template...
```

### Claude

Invoked as:

```
/plugin-name:hello
```

### Copilot

Exposed as CLI command
May conflict silently

### Implementation

* Parse frontmatter
* Map to internal command registry
* Namespace consistently
* Apply mode-specific exposure rules

---

## 4.4 Hooks (`hooks.json`)

### Format

```json
{
  "onStart": "echo starting",
  "onTaskComplete": "echo done"
}
```

### Behavior

Conceptually identical across systems.

### Implementation

* Validate JSON
* Map lifecycle events
* Normalize event names if necessary
* Execute in isolated subprocess

---

## 4.5 MCP Servers (`.mcp.json`)

### Format

```json
{
  "servers": {
    "my-server": {
      "command": "node server.js"
    }
  }
}
```

### Differences

Claude enforces strict directory sandbox:

* Server files must reside inside plugin directory

Copilot does not explicitly enforce but should follow same rule.

### Implementation

* Validate commands
* Ensure no path traversal outside plugin root
* Start servers as managed child processes

---

## 4.6 LSP Servers (`.lsp.json`)

Same handling as MCP.

Ensure:

* Command paths are relative to plugin directory
* No external file references

---

# 5. Conflict Resolution Strategy

## Claude Mode

* Allow duplicate component names across plugins
* Enforce full namespace resolution
* Do not suppress components

## Copilot Mode

* Detect duplicates
* Apply first-loaded precedence
* Emit warning for suppressed duplicates

---

# 6. Filesystem Isolation

Mandatory for Claude compatibility:

* All referenced files must exist within plugin directory
* Reject:

  * `../` traversal
  * Absolute paths
* Copy plugin into cache-safe location if needed

Recommended for Copilot mode as well.

---

# 7. Unified Internal Plugin Model

Represent plugins internally as:

```
Plugin {
  name
  metadata
  agents[]
  skills[]
  commands[]
  hooks
  mcpServers
  lspServers
  mode: claude | copilot
}
```

All components should be normalized into this structure before execution.

---

# 8. Dual-Compatible Packaging Rules

To generate a plugin compatible with both:

## Required Layout

```
my-plugin/
│
├── plugin.json
├── agents/
├── skills/
├── commands/
├── hooks.json
├── .mcp.json
├── .lsp.json
└── .claude-plugin/
    └── plugin.json
```

## Build Strategy

1. Maintain single source metadata file (e.g., `plugin.config.json`)
2. Generate:

   * root `plugin.json`
   * `.claude-plugin/plugin.json`
3. Validate:

   * No external file references
   * All component directories exist

---

# 9. Validation Checklist

When loading a plugin:

* [ ] Plugin directory exists
* [ ] Root `plugin.json` present (Copilot mode)
* [ ] Plugin name is kebab-case
* [ ] All declared component paths exist
* [ ] No directory traversal outside root
* [ ] All Markdown files contain valid YAML frontmatter
* [ ] No duplicate component IDs (handle per mode)
* [ ] JSON files parse successfully

---

# 10. Mode Behavior Summary

| Feature              | Claude   | Copilot                 |
| -------------------- | -------- | ----------------------- |
| Manifest required    | No       | Yes                     |
| Namespacing          | Explicit | Implicit                |
| Duplicate handling   | Allowed  | First-wins              |
| Sandbox enforcement  | Strict   | Not strictly documented |
| outputStyles support | Yes      | No                      |

---

# 11. Recommended Implementation Order

1. Filesystem sandbox layer
2. Manifest loader
3. Component discovery engine
4. Markdown frontmatter parser
5. Conflict resolver
6. Lifecycle hook executor
7. MCP/LSP process manager
8. Dual-manifest generator (optional)

---

# 12. Important Behavioral Constraints

* Do not rely on external filesystem paths
* Do not assume manifest exists in Claude mode
* Do not assume auto-discovery works in Copilot mode
* Do not silently suppress duplicates without logging
* Always namespace internally

---

# 13. Testing Matrix

Test each plugin in:

| Scenario                      | Expected Result                  |
| ----------------------------- | -------------------------------- |
| Claude without manifest       | Auto-discovery works             |
| Copilot without manifest      | Fail                             |
| Duplicate agent names         | Claude: OK / Copilot: first wins |
| MCP server with external path | Fail                             |
| Missing component directory   | Soft fail if optional            |

---

# 14. Final Design Principle

Treat both systems as:

> Same plugin architecture with different manifest requirements and collision semantics.

If you normalize:

* component parsing
* sandbox enforcement
* namespacing
* manifest loading

You can support both systems with one shared loader and a small behavior switch for:

* manifest requirement
* duplicate resolution
* outputStyles handling

---

END OF SPECIFICATION

```
```
