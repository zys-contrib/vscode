```markdown
# Plugin Loading Specification
## Folder-Targeted Plugin Resolution for Copilot CLI + Claude Code Compatibility

This specification defines how the application must:

1. Discover plugins relevant to a specific target folder
2. Determine applicable scope
3. Load and normalize plugins
4. Resolve conflicts
5. Enforce sandboxing
6. Activate components
7. Handle mode differences (Claude vs Copilot)

This spec assumes the plugin format described in the Dual Plugin Support Implementation Guide.

---

# 1. Goals

When the application is pointed at a target folder (project directory), it must:

- Load all plugins relevant to that folder
- Respect scope precedence
- Support both Claude-style and Copilot-style plugins
- Normalize into a unified internal model
- Avoid collisions and sandbox violations
- Be deterministic and reproducible

---

# 2. Terminology

| Term | Meaning |
|------|---------|
| Target Folder | The project directory currently being operated on |
| Plugin Root | Directory containing plugin components |
| Mode | `claude` or `copilot` |
| Scope | Installation level: global, user, project, local |
| Normalized Plugin | Internal representation after parsing |

---

# 3. Supported Plugin Scopes

Plugins may exist at:

### 3.1 Global Scope
System-wide installation directory
Example:
```

/usr/local/share/app/plugins/

```

### 3.2 User Scope
User-specific directory
Example:
```

~/.app/plugins/

```

### 3.3 Project Scope
Within the target folder
Example:
```

<target>/.app/plugins/

```

### 3.4 Local Explicit Path
Direct path passed by CLI flag

---

# 4. Plugin Discovery Algorithm

When targeting a folder:

## 4.1 Resolve Candidate Plugin Directories (Ordered by Precedence)

1. Explicitly passed plugin paths
2. `<target>/.app/plugins/`
3. `<target>/.claude/plugins/` (Claude compatibility)
4. User plugin directory
5. Global plugin directory

Within each directory:
- Each subdirectory is treated as a plugin candidate.

---

# 5. Plugin Validity Check

For each candidate directory:

### Step 1: Confirm Directory Exists
Must be a directory.

### Step 2: Detect Compatibility Mode

If root `plugin.json` exists → Copilot-compatible
If `.claude-plugin/plugin.json` exists → Claude-compatible
If components exist without manifest → Claude-compatible

If neither manifest nor components found → ignore directory.

### Step 3: Validate Structure

- No symlinks escaping plugin root
- No `../` references
- No absolute paths in configs
- All referenced component paths must exist

If validation fails → reject plugin.

---

# 6. Plugin Loading Order

Plugins must be loaded in deterministic order:

```

Explicit > Project > User > Global

```

Within each scope:
- Alphabetical order by plugin directory name

This ensures consistent first-wins semantics in Copilot mode.

---

# 7. Normalization Process

For each valid plugin:

## 7.1 Load Manifest

If in Copilot mode:
- Require root `plugin.json`

If in Claude mode:
- Load `.claude-plugin/plugin.json` if present
- Otherwise auto-discover components

## 7.2 Discover Components

Default paths:
```

agents/
skills/
commands/
hooks.json
.mcp.json
.lsp.json

```

If manifest overrides paths:
- Use declared paths instead

## 7.3 Parse Markdown Components

For each `.md` file:
- Extract YAML frontmatter
- Require `name`
- Capture description
- Store body as content

## 7.4 Build Internal Representation

```

NormalizedPlugin {
name
scope
path
metadata
agents[]
skills[]
commands[]
hooks
mcpServers
lspServers
}

```

---

# 8. Conflict Resolution Rules

Conflict resolution differs by mode.

---

## 8.1 Claude Mode

- All components are namespaced by plugin name.
- No suppression.
- Fully qualified name format:

```

plugin-name/component-name

```

Duplicates across plugins are allowed.

---

## 8.2 Copilot Mode

Apply first-loaded-wins:

If component ID already exists:
- Ignore later duplicate
- Log warning

Applies to:
- agents
- skills
- commands

Hooks:
- Merge if events differ
- Override if same event key (first wins)

---

# 9. Sandbox Enforcement

Before activating any plugin:

- Ensure all file references are inside plugin directory
- Disallow:
  - Absolute paths
  - Parent directory traversal
- Reject plugin if violation detected

This is mandatory for Claude compatibility and recommended universally.

---

# 10. Activation Phase

After normalization and conflict resolution:

## 10.1 Register Agents
Add to agent registry (namespaced internally).

## 10.2 Register Skills
Add to skill registry.

## 10.3 Register Commands
Bind slash or CLI commands.

## 10.4 Initialize Hooks
Attach to lifecycle event dispatcher.

## 10.5 Start MCP Servers
Launch as managed child processes.

## 10.6 Start LSP Servers
Launch per configuration.

---

# 11. Runtime Lifecycle

When targeting a folder:

1. Discover plugins
2. Validate and normalize
3. Resolve conflicts
4. Activate components
5. Dispatch `onStart` hooks
6. Process user commands
7. Dispatch lifecycle events
8. On shutdown:
   - Stop MCP servers
   - Stop LSP servers
   - Dispatch `onExit` hooks

---

# 12. Reloading Strategy

If target folder changes:

- Unload all project-scope plugins
- Re-run discovery
- Preserve user/global plugins

If plugin directory changes:
- Require explicit reload
- Do not auto-watch filesystem unless configured

---

# 13. Error Handling Rules

If a plugin fails validation:
- Log error
- Continue loading others

If a component file is malformed:
- Skip component
- Do not reject entire plugin

If manifest missing in Copilot mode:
- Reject plugin

---

# 14. Performance Considerations

- Cache normalized plugins per folder
- Hash plugin directory contents
- Invalidate cache if hash changes
- Avoid re-parsing Markdown unnecessarily

---

# 15. Determinism Requirements

The loader must guarantee:

- Same folder + same plugin directories → identical component registry
- Load order strictly defined
- Conflict handling predictable

---

# 16. Testing Matrix

| Scenario | Expected Result |
|----------|-----------------|
| Duplicate agent in two global plugins | Copilot: first wins |
| Same duplicate in Claude | Both available |
| Plugin without manifest in Claude | Loads |
| Plugin without manifest in Copilot | Rejected |
| Plugin referencing external file | Rejected |
| Corrupt Markdown frontmatter | Skip component |

---

# 17. Security Requirements

- No execution of arbitrary shell commands outside MCP/LSP explicitly configured
- Hooks must run in controlled subprocess
- Validate JSON before execution
- Enforce directory isolation

---

# 18. Summary of Mode Differences

| Feature | Claude | Copilot |
|----------|---------|----------|
| Manifest required | No | Yes |
| Auto-discovery | Yes | No |
| Duplicate handling | Namespaced | First-wins |
| Strict sandbox | Yes | Recommended |

---

# 19. Final Design Principle

Treat plugin loading as:

> Scoped, sandboxed, deterministic component aggregation with mode-specific collision semantics.

All plugins must normalize into a unified internal model before activation.

---

END OF SPECIFICATION
```
