# Secrets Sharing Implementation Notes

**Spec**: `secrets-sharing-spec.md` (in this repo)
**Issue**: https://github.com/microsoft/vscode/issues/308028
**PR**: https://github.com/microsoft/vscode-macos-keychain/pull/1
**Date started**: 9 April 2026

## What's been done

### Phase 1, Step 1: macOS native Node addon (`@vscode/macos-keychain`)

**Location**: `/Users/alex/src/vscode-macos-keychain/` (separate repo, https://github.com/microsoft/vscode-macos-keychain)
**Branch**: `alexdima/keychain-addon`
**Status**: Addon built, compiles cleanly, 11/11 tests passing. Draft PR open.

The addon wraps the macOS Security framework (`SecItemAdd`, `SecItemCopyMatching`, `SecItemUpdate`, `SecItemDelete`) with `kSecAttrAccessGroup` support for cross-app keychain sharing.

#### Files created

```
vscode-macos-keychain/
  package.json          # @vscode/macos-keychain, deps: bindings + node-addon-api, os: ["darwin"]
  package-lock.json
  binding.gyp           # node-gyp config, links Security + CoreFoundation
  index.js              # JS wrapper using `bindings` package (with platform guard)
  index.d.ts            # TypeScript type definitions
  src/
    main.cc             # Node-API entry point (Napi:: C++ wrapper)
    keychain.h           # Header: CFRef<T> RAII wrapper + function declarations
    keychain.cc          # Core implementation: buildBaseQuery, set/get/delete/list
  test/
    test.js             # mocha test suite (11 tests)
  azure-pipelines.yml   # Azure DevOps CI/CD + npm publishing pipeline
  .github/workflows/ci.yml  # GitHub Actions CI (macOS, Node 22.x)
  .npmignore            # Excludes CI, meta files from published package
  .vscode/settings.json # Branch protection config
  LICENSE               # MIT (from upstream repo template)
  README.md             # Project docs with API, usage, entitlements, testing
  CODE_OF_CONDUCT.md    # From upstream repo template
  SECURITY.md           # From upstream repo template
  SUPPORT.md            # From upstream repo template
  .gitignore            # Minimal: /node_modules, /build (matches policy-watcher)
```

#### API

```typescript
keychainSet(service: string, account: string, value: string, accessGroup: string): void
keychainGet(service: string, account: string, accessGroup: string): string | undefined
keychainDelete(service: string, account: string, accessGroup: string): boolean
keychainList(service: string, accessGroup: string): string[]
```

All string arguments reject embedded NUL bytes. This is intentional: the native CoreFoundation string conversion used by the addon treats NUL as a terminator, so allowing embedded NUL would let distinct logical keys alias the same Keychain item.

## Decisions and rationale

### 1. Template: `@vscode/policy-watcher` (not `native-keymap`)

We surveyed ALL native Node addons used by VS Code:

| Package | macOS native? | API style | Loader |
|---------|:---:|---|---|
| `native-keymap` (`node-native-keymap`) | Yes (.mm) | Raw `napi_*` C API | Manual `require('./build/Release/...')` |
| `@vscode/policy-watcher` | Yes (C++) | `node-addon-api` (C++ NAPI wrapper) | `bindings` package |
| `@vscode/spdlog` | Yes (cross-platform C++) | `node-addon-api` | `bindings` |
| `@vscode/windows-mutex` | No (Windows) | `node-addon-api` | `bindings` |
| `@vscode/deviceid` | No (Windows) | Raw NAPI | Manual |
| `@vscode/windows-process-tree` | No (Windows) | — | — |
| `node-pty` | Yes | — | Too complex for reference |

**Decision**: Use `@vscode/policy-watcher` as the primary template because:
- It uses the modern `node-addon-api` C++ wrapper (cleaner than raw `napi_*`)
- It has macOS-specific native code in `src/macos/`
- It uses the `bindings` package for loading (standard pattern)
- It's a Microsoft project with the same license/header conventions
- `native-keymap` is older: raw C NAPI, manual `require('./build/Release/...')` loading, Objective-C++ `.mm` files

### 2. `node-addon-api` version: `^8.2.0` (not `7.1.0`)

VS Code's `package.json` pins `node-addon-api` at `7.1.0`, but `@vscode/policy-watcher` (the newest addon) uses `^8.2.0`. We followed the newer addon's lead. This may need alignment when the addon is added to VS Code's dependencies.

### 3. `Napi::Boolean` must be fully qualified

**Problem discovered during build**: `return Boolean::New(env, deleted)` caused a compilation error:

```
error: reference to 'Boolean' is ambiguous
```

macOS `MacTypes.h` defines `typedef unsigned char Boolean;` which conflicts with `Napi::Boolean`. The file has `using namespace Napi;` so both are in scope.

**Fix**: Use `Napi::Boolean::New(env, deleted)` instead of `Boolean::New(env, deleted)`. This only affects `Boolean` — `String`, `Array`, `Value`, etc. don't have conflicts with macOS system headers.

### 4. `kSecUseDataProtectionKeychain` availability warning

**Problem discovered during build**: The compiler warns:

```
'kSecUseDataProtectionKeychain' is only available on macOS 10.15 or newer [-Wunguarded-availability-new]
```

This is because node-gyp defaults `MACOSX_DEPLOYMENT_TARGET` to `10.7`, and `kSecUseDataProtectionKeychain` was introduced in 10.15.

**Attempted fixes**:
1. `"MACOSX_DEPLOYMENT_TARGET": "10.15"` in xcode_settings — **did not work** because node-gyp uses `make` on macOS (not Xcode), so xcode_settings for deployment target are ignored by the makefile generator.
2. `"CLANG_WARN_UNGUARDED_AVAILABILITY": "NO"` in xcode_settings — **did not work** for the same reason.
3. `"-Wno-unguarded-availability-new"` in `WARNING_CFLAGS` (xcode_settings) — **worked**. The `WARNING_CFLAGS` xcode_setting DOES get passed through to the compiler via the makefile.

**Final fix**: Added `-Wno-unguarded-availability-new` to both `cflags` (for GCC/Clang direct builds) and `WARNING_CFLAGS` (for xcode_settings pass-through). Also kept `MACOSX_DEPLOYMENT_TARGET: "10.15"` for documentation purposes even though node-gyp overrides it.

VS Code already requires macOS 10.15+, so the availability guard is unnecessary.

### 5. Access group is optional (empty string = skip)

**Problem discovered during testing**: All keychain operations fail with `-34018` (`errSecMissingEntitlement`) when `kSecUseDataProtectionKeychain = true` is set but the app isn't signed with the `keychain-access-groups` entitlement. This means you **cannot test the addon locally** with a real access group using plain `node`.

**Solution**: When `accessGroup` is an **empty string**, `buildBaseQuery()` skips both `kSecAttrAccessGroup` and `kSecUseDataProtectionKeychain`. Items go to the app's default keychain, which works without entitlements. This enables local development and CI testing.

When `accessGroup` is non-empty (production), both attributes are set, requiring proper entitlements. This is the intended code path inside signed VS Code/Agents builds.

### 6. Set is upsert (add-then-update pattern)

`keychainSet` first calls `SecItemAdd`. If that returns `errSecDuplicateItem`, it falls back to building a new search query + `SecItemUpdate`. This two-step pattern is the standard approach for macOS Keychain — there is no "upsert" API.

Note: The update path builds a **new** search query (without `kSecValueData`) and a separate attributes dict (with only `kSecValueData`). This is required by `SecItemUpdate` — it does not accept `kSecValueData` in the query dictionary.

### 7. `CFRef<T>` RAII wrapper for CoreFoundation objects

CoreFoundation objects must be `CFRelease`d. Rather than tracking releases manually (error-prone, especially with early returns and exceptions), we use a `CFRef<T>` template class that calls `CFRelease` in its destructor. It supports move semantics. When setting `CFRef`-managed objects into CF dictionaries, we use `.get()` so the RAII wrapper's destructor balances the create, while `CFDictionarySetValue` (with `kCFTypeDictionaryValueCallBacks`) retains its own +1 reference.

**Note**: An earlier version used `.release()` to transfer ownership into dictionaries, which caused a refcount leak — `CFDictionarySetValue` retains the value, but `.release()` also gave up RAII ownership, leaving a dangling +1. Fixed by switching to `.get()`.

### 8. Error messages include human-readable text and OSStatus code (no account names)

All error paths use `SecCopyErrorMessageString` to get a human-readable description and also include the numeric OSStatus code. Example: `"Keychain set failed: A required entitlement isn't present. (-34018)"`. Account and service names are intentionally **omitted** from error messages to prevent them from leaking into telemetry or log files.

### 9. Secrets stored as plaintext in Keychain (not encrypted separately)

Per the spec: macOS Keychain `kSecClassGenericPassword` does NOT have the blob size limitations that Windows CredMan has. The keychain itself IS the secure storage — no need for an additional encryption layer (unlike the current safeStorage + SQLite approach). Values are stored as `kSecValueData` (`CFData` from UTF-8 bytes) directly.

### 10. Test cleanup uses beforeEach/afterEach with try-catch

Tests clean up keychain items in both `beforeEach` and `afterEach` to ensure idempotency even if a previous test run crashed. The `try-catch` handles the case where items don't exist.

### 11. Platform guard in index.js + `"os": ["darwin"]` in package.json

Added `if (process.platform !== 'darwin') throw ...` at the top of `index.js` for a clear error message at import time. Also added `"os": ["darwin"]` to `package.json` so `npm install` fails fast on non-macOS. The existing VS Code addons don't use either pattern, but this module is macOS-only by design so both are appropriate.

### 12. Null check for updateAttrs dictionary

Added a null check after `CFDictionaryCreateMutable` for the `updateAttrs` dict in the update path of `keychainSet`, consistent with the existing check in `buildBaseQuery`.

### 13. Security hardening (from security audit)

A dedicated security audit identified and fixed the following:

- **CF ownership fix**: Fixed CoreFoundation reference counting in `buildBaseQuery` — changed `.release()` to `.get()` for values set into dictionaries, since `CFDictionarySetValue` retains. The original `.release()` left a dangling +1 refcount on every keychain call.
- **Secret zeroing**: A `secureClear()` utility uses a `volatile char*` pointer to zero `std::string` buffers containing secrets immediately after use, preventing the compiler from optimizing away the zeroing. Applied to the `value` parameter in `keychainSet` and the return value in `keychainGet`.
- **Build hardening flags**: Added `-D_FORTIFY_SOURCE=2` (runtime buffer overflow checks) and `-Wformat -Wformat-security` (format string vulnerability warnings) alongside the existing `-fstack-protector-strong`.
- **Error message sanitization**: Removed account/service names from error messages to avoid leaking them into telemetry or log files. The caller already knows these values.
- **Input length bounds**: Values are capped at 100 KB, and service/account/accessGroup strings at 1 KB. Apple does not document hard keychain item size limits, but the Data Protection keychain (SQLite-backed) is known to work reliably up to ~100 KB. These bounds provide predictable error messages instead of opaque OS-level failures.
- **NUL byte rejection**: All string arguments are validated to reject embedded NUL bytes, which could cause silent truncation when passed to CoreFoundation `CFStringCreateWithCString`.

### 14. CI/CD and project meta files

`azure-pipelines.yml` follows the `@vscode/policy-watcher` pattern: uses `microsoft/vscode-engineering` pipeline templates for npm package build/test/publish. Only tests on macOS (unlike cross-platform addons). GitHub Actions CI (`.github/workflows/ci.yml`) runs on `macos-latest` with Node 22.x. `.npmignore` excludes CI files, meta docs, and build artifacts from the published package.

### 15. Git rebase gotcha: `--ours`/`--theirs` are swapped

During `git rebase origin/main`, conflict resolution with `git checkout --ours README.md` took the **upstream** version, not ours. This is because rebase replays our commits onto the upstream, making the upstream `HEAD` the "ours" and our commit the "theirs". The README was silently lost and discovered later. Lesson: during rebase conflicts, use `--theirs` to keep your own changes.

## Things NOT done yet (from the spec's Phase 1 plan)

### Step 2: Entitlements
Add `keychain-access-groups` entitlement to both Code and Agents app builds:
- Location: `build/darwin/` entitlements files
- Value: `$(TeamIdentifierPrefix)com.microsoft.vscode.shared-secrets`
- Both Code.app and the nested Agents .app need the same group

### Step 3: `ISharedSecretStorageService` in VS Code
New service that:
- On write: stores in shared keychain via addon + optionally keeps old pipeline in sync
- On read: reads from shared keychain, falls back to old safeStorage+SQLite
- On delete: deletes from both
- Files involved: `src/vs/platform/secrets/`, `src/vs/workbench/services/secrets/`

### Step 4: Migration logic
One-time migration in Code on startup:
- Read all `secret://`-prefixed keys from SQLite (IStorageService)
- Decrypt each with existing safeStorage (IEncryptionService)
- Write plaintext to shared keychain via addon
- Must be idempotent/re-entrant
- Store migration-complete flag

### Step 5: Wire up the Agents app
The Agents app (`src/vs/sessions/sessions.desktop.main.ts`) should use the shared keychain for secrets. It reads from the shared keychain directly — no migration needed from the Agents side.

### Step 6: Testing with real auth tokens
Test with large Microsoft account refresh tokens (the ones that exceed Windows CredMan's ~2.5KB limit). macOS Keychain should handle them fine but needs verification.

## Open questions (from spec, still open)

1. **Naming convention for keychain items**: What `kSecAttrService` value? Spec suggests `"com.microsoft.vscode.shared-secrets"` — needs to be stable across versions.
2. **Entitlement signing**: Does adding `keychain-access-groups` require CI/CD signing process changes?
3. **Notification/sync**: Should Code notify Agents in real-time when secrets change? Or read-on-demand?
4. **Scope**: Share ALL secrets or only auth-related ones?

## Environment notes

- Built and tested on macOS (Darwin 25.4.0, arm64)
- Node.js v22.22.1
- node-gyp v11.2.0 (bundled with npm)
- `node-addon-api` v8.3.1 (resolved from `^8.2.0`)
- Compilation uses `make` (not Xcode), which affects how xcode_settings are applied
- GPG commit signing fails inside the VS Code agent sandbox (can't access `~/.gnupg` or gpg-agent) — must use unsandboxed execution for `git commit -S` and `git push`
