# Working Notes: New esbuild-based Build System

> These notes are for AI agents to help with context in new or summarized sessions.

## Important: Validating Changes

**The `VS Code - Build` task is NOT needed to validate changes in the `build/` folder!**

Build scripts in `build/` are TypeScript files that run directly with `tsx` (e.g., `npx tsx build/next/index.ts`). They are not compiled by the main VS Code build.

To test changes:
```bash
# Test transpile
npx tsx build/next/index.ts transpile --out out-test

# Test bundle (server-web target to test the auth fix)
npx tsx build/next/index.ts bundle --nls --target server-web --out out-vscode-reh-web-test

# Verify product config was injected
grep -l "serverLicense" out-vscode-reh-web-test/vs/code/browser/workbench/workbench.js
```

---

## Architecture Overview

### Files

- **[index.ts](index.ts)** - Main build orchestrator
  - `transpile` command: Fast TS → JS using `esbuild.transform()`
  - `bundle` command: TS → bundled JS using `esbuild.build()`
- **[nls-plugin.ts](nls-plugin.ts)** - NLS (localization) esbuild plugin

### Integration with Old Build

In [gulpfile.vscode.ts](../gulpfile.vscode.ts#L228-L242), the `core-ci` task uses these new scripts:
- `runEsbuildTranspile()` → transpile command
- `runEsbuildBundle()` → bundle command

Old gulp-based bundling renamed to `core-ci-OLD`.

---

## Key Learnings

### 1. Comment Stripping by esbuild

**Problem:** esbuild strips comments like `/*BUILD->INSERT_PRODUCT_CONFIGURATION*/` during bundling.

**Solution:** Use an `onLoad` plugin to transform source files BEFORE esbuild processes them. See `fileContentMapperPlugin()` in index.ts.

**Why post-processing doesn't work:** By the time we post-process the bundled output, the comment placeholder has already been stripped.

### 2. Authorization Error: "Unauthorized client refused"

**Root cause:** Missing product configuration in browser bundle.

**Flow:**
1. Browser loads with empty product config (placeholder was stripped)
2. `productService.serverLicense` is empty/undefined
3. Browser's `SignService.vsda()` can't decrypt vsda WASM (needs serverLicense as key)
4. Browser's `sign()` returns original challenge instead of signed value
5. Server validates signature → fails
6. Server is in built mode (no `VSCODE_DEV`) → rejects connection

**Fix:** The `fileContentMapperPlugin` now runs during `onLoad`, replacing placeholders before esbuild strips them.

### 3. Build-Time Placeholders

Two placeholders that need injection:

| Placeholder | Location | Purpose |
|-------------|----------|---------|
| `/*BUILD->INSERT_PRODUCT_CONFIGURATION*/` | `src/vs/platform/product/common/product.ts` | Product config (commit, version, serverLicense, etc.) |
| `/*BUILD->INSERT_BUILTIN_EXTENSIONS*/` | `src/vs/workbench/services/extensionManagement/browser/builtinExtensionsScannerService.ts` | List of built-in extensions |

### 4. Server-web Target Specifics

- Removes `webEndpointUrlTemplate` from product config (see `tweakProductForServerWeb` in old build)
- Uses `.build/extensions` for builtin extensions (not `.build/web/extensions`)

---

## Testing the Fix

```bash
# Build server-web with new system
npx tsx build/next/index.ts bundle --nls --target server-web --out out-vscode-reh-web-min

# Package it (uses gulp task)
npm run gulp vscode-reh-web-darwin-arm64-min

# Run server
./vscode-server-darwin-arm64-web/bin/code-server-oss --connection-token dev-token

# Open browser - should connect without "Unauthorized client refused"
```

---

## Open Items / Future Work

1. **`BUILD_INSERT_PACKAGE_CONFIGURATION`** - Server bootstrap files ([bootstrap-meta.ts](../../src/bootstrap-meta.ts)) have this marker for package.json injection. Currently handled by [inlineMeta.ts](../lib/inlineMeta.ts) in the old build's packaging step.

2. **Mangling** - The new build doesn't do TypeScript-based mangling yet. Old `core-ci` with mangling is now `core-ci-OLD`.

3. **Entry point duplication** - Entry points are duplicated between [buildfile.ts](../buildfile.ts) and [index.ts](index.ts). Consider consolidating.

---

## Self-hosting Setup

The default `VS Code - Build` task now runs three parallel watchers:

| Task | What it does | Script |
|------|-------------|--------|
| **Core - Transpile** | esbuild single-file TS→JS (fast, no type checking) | `watch-client-transpiled` → `npx tsx build/next/index.ts transpile --watch` |
| **Core - Typecheck** | gulp-tsb `noEmit` watch (type errors only, no output) | `watch-clientd` → `gulp watch-client` (with `noEmit: true`) |
| **Ext - Build** | Extension compilation (unchanged) | `watch-extensionsd` |

### Key Changes

- **`compilation.ts`**: `ICompileTaskOptions` gained `noEmit?: boolean`. When set, `overrideOptions.noEmit = true` is passed to tsb. `watchTask()` accepts an optional 4th parameter `{ noEmit?: boolean }`.
- **`gulpfile.ts`**: `watchClientTask` no longer runs `rimraf('out')` (the transpiler owns that). Passes `{ noEmit: true }` to `watchTask`.
- **`index.ts`**: Watch mode emits `Starting transpilation...` / `Finished transpilation with N errors after X ms` for VS Code problem matcher.
- **`tasks.json`**: Old "Core - Build" split into "Core - Transpile" + "Core - Typecheck" with separate problem matchers (owners: `esbuild` vs `typescript`).
- **`package.json`**: Added `watch-client-transpile`, `watch-client-transpiled`, `kill-watch-client-transpiled` scripts.
