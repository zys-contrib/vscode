# Secrets Sharing Implementation Notes

**Spec**: `secrets-sharing-spec.md` (in this repo)
**Issue**: https://github.com/microsoft/vscode/issues/308028
**VS Code PR**: https://github.com/microsoft/vscode/pull/308990
**Date started**: 9 April 2026

## Current status: Phase 1 (macOS) — feature-complete, testing in progress

All Phase 1 steps from the spec are implemented. The end-to-end flow (Code writes secrets → Agents reads them) works locally.

## What's been done

### Step 1: macOS native Node addon (`@vscode/macos-keychain`)

**Repo**: https://github.com/microsoft/vscode-macos-keychain
**PR #1** (merged): Initial addon with access group support
**PR #2** (open): Auto-detect access group from entitlements
**PR #3** (open): Fix build on non-macOS CI

The addon wraps the macOS Security framework (`SecItemAdd`, `SecItemCopyMatching`, `SecItemUpdate`, `SecItemDelete`).

#### API (after PR #2)

```typescript
keychainSet(service: string, account: string, value: string): void
keychainGet(service: string, account: string): string | undefined
keychainDelete(service: string, account: string): boolean
keychainList(service: string): string[]
```

The `accessGroup` parameter was removed from the public API. Instead, `keychainInit()` (called automatically at module load) reads the process's `keychain-access-groups` entitlement via `SecTaskCopyValueForEntitlement` and caches the first access group found. If no entitlement exists (unsigned/dev builds), items go to the app's default keychain.

### Step 2: Entitlements

Added `keychain-access-groups` to `build/azure-pipelines/darwin/app-entitlements.plist`:

```xml
<key>keychain-access-groups</key>
<array>
    <string>$(TeamIdentifierPrefix)com.microsoft.vscode.shared-secrets</string>
</array>
```

Both Code.app and its embedded Agents.app use the same entitlements file (via `getEntitlementsForFile()` in `build/darwin/sign.ts`), so both get the shared access group.

### Step 3: ISharedKeychainService

Follows the standard Electron main process IPC service pattern (like `IEncryptionService`):

| Layer | File | Role |
|-------|------|------|
| Common interface | `src/vs/platform/secrets/common/sharedKeychainService.ts` | `ISharedKeychainService` + `ISharedKeychainMainService` decorators and interfaces |
| Main process impl | `src/vs/platform/secrets/electron-main/sharedKeychainMainService.ts` | `SharedKeychainMainService` — wraps native addon, no-op on non-macOS |
| Main process registration | `src/vs/code/electron-main/app.ts` | `services.set(ISharedKeychainMainService, ...)` + `ProxyChannel.fromService(...)` + `registerChannel('sharedKeychain', ...)` |
| Renderer proxy | `src/vs/workbench/services/secrets/electron-browser/sharedKeychainService.ts` | `registerMainProcessRemoteService(ISharedKeychainService, 'sharedKeychain')` |

**Design decisions**:
- Service is registered on all platforms; the main process implementation is a no-op on non-macOS (`enabled = isMacintosh && !!productService.darwinSharedKeychainServiceName`)
- `set()` is best-effort (logs error, does not throw) — callers also write to the legacy pipeline for rollback safety, so shared keychain failures should not break secret persistence
- `get()`/`delete()`/`keys()` are also best-effort (return `undefined`/`false`/`[]` on error)

### Step 4: NativeSecretStorageService changes

`src/vs/workbench/services/secrets/electron-browser/secretStorageService.ts`:

**Base class refactoring**: `BaseSecretStorageService` now exposes protected `_doGet`/`_doSet`/`_doDelete`/`_doGetKeys` methods that perform the actual safeStorage+SQLite operations without going through the sequencer. This allows subclasses to call them from within their own sequencer-queued tasks without deadlocking (since `SequencerByKey` would deadlock if the same key is queued from within a queued task).

**NativeSecretStorageService overrides** (all guarded by `this.type !== 'in-memory'`):
- `get()`: tries shared keychain first, falls back to `_doGet()` (legacy pipeline)
- `set()`: writes to shared keychain, then `_doSet()` (dual-write for rollback safety)
- `delete()`: deletes from shared keychain, then `_doDelete()`
- `keys()`: merges results from shared keychain and `_doGetKeys()`

### Step 5: Migration

One-time, lazy migration runs on the first secret operation:

1. `_ensureMigration()` is called at the start of every `get`/`set`/`delete`/`keys` (when `type !== 'in-memory'`)
2. Reads all `secret://`-prefixed keys from SQLite via `_doGetKeys()`
3. Decrypts each with safeStorage via `_doGet()`
4. Writes plaintext to shared keychain via `_sharedKeychainService.set()`
5. Stores `sharedKeychain.migrationDone = '1'` in `StorageScope.APPLICATION`
6. Subsequent calls skip migration (cached promise + storage flag)

**Properties**:
- Idempotent: keychain writes are upserts, storage flag prevents re-runs across sessions
- Best-effort per key: individual failures don't block the rest
- Safe with multiple windows: concurrent migrations do redundant but harmless work (all write the same values)
- Skipped for in-memory mode

### Step 6: Agents app wiring

`src/vs/sessions/sessions.desktop.main.ts` imports both:
- `../workbench/services/secrets/electron-browser/secretStorageService.js` (NativeSecretStorageService)
- `../workbench/services/secrets/electron-browser/sharedKeychainService.js` (IPC proxy)

The Agents app reads from the shared keychain via the same `NativeSecretStorageService` overrides. No separate migration needed — it reads whatever Code wrote.

### Product configuration

**`darwinSharedKeychainServiceName`** — the `kSecAttrService` value that groups keychain items. Per-flavor to isolate secrets between Stable/Insiders/Exploration:

| Flavor | Value |
|--------|-------|
| Code OSS | `com.visualstudio.code.oss.shared-secrets` (set in `product.json`) |
| Code Stable | Set in internal product.json (e.g. `com.microsoft.vscode.shared-secrets`) |
| Code Insiders | Set in internal product.json (e.g. `com.microsoft.vscode-insiders.shared-secrets`) |

This field is at the **top level** of product.json, NOT in the `embedded` section — so both Code and its embedded Agents app within the same flavor get the same value. The `embedded` overlay (in `build/gulpfile.vscode.ts`) only copies fields listed in `IEmbeddedProductConfiguration`.

**`darwinKeychainAccessGroup`** — removed from product.json. The native addon auto-detects it from the process's entitlements at module load time. This avoids keeping the team ID prefix in sync between the entitlements plist and product.json.

### Other files changed

| File | Change |
|------|--------|
| `package.json` | Added `@vscode/macos-keychain` to `optionalDependencies` (macOS-only) |
| `build/.moduleignore` | Added entries for `@vscode/macos-keychain` (keep only `.node` binary) |
| `src/typings/macos-keychain.d.ts` | Type declarations for cross-platform compilation |
| `src/vs/base/common/product.ts` | Added `darwinSharedKeychainServiceName` to `IProductConfiguration` |
| `src/vs/workbench/workbench.desktop.main.ts` | Import shared keychain service registration |
| `src/vs/sessions/sessions.desktop.main.ts` | Import shared keychain service registration |

## Decisions and rationale

### 1. Template: `@vscode/policy-watcher` (not `native-keymap`)

Used `@vscode/policy-watcher` as the template for the native addon because it uses modern `node-addon-api` (C++ NAPI wrapper), `bindings` package for loading, and has macOS-specific native code.

### 2. Access group auto-detection (PR #2)

Initially the `accessGroup` was a JS parameter passed through to the native code. This required keeping the team ID prefix (e.g. `UBF8T346G9.com.microsoft.vscode.shared-secrets`) in product.json, which was error-prone and would diverge from the entitlements plist.

**Solution**: The native addon calls `SecTaskCopyValueForEntitlement` at module init to read the `keychain-access-groups` entitlement from its own process. This makes the access group an implementation detail — JS never needs to know the team ID prefix.

### 3. IPC service pattern (not direct import)

The native addon runs in the **main process** (via `SharedKeychainMainService`), exposed to renderer windows via `ProxyChannel`/`registerMainProcessRemoteService`. This follows the established pattern for native services (like `IEncryptionService`). An earlier attempt to load the addon directly in the `electron-browser` layer failed layering checks — the `electron-browser` tsconfig doesn't include `node/` files.

### 4. Dual-write for rollback safety

`set()` writes to both the shared keychain AND the legacy safeStorage+SQLite pipeline. This means if we discover a critical issue with the shared keychain, we can remove the new code path and all secrets are still in the old storage. The legacy pipeline can be removed in a future release once the shared keychain is proven stable.

### 5. Best-effort shared keychain operations

All `SharedKeychainMainService` methods catch errors and return safe defaults (`undefined`/`false`/`[]`). This prevents shared keychain failures (e.g. missing entitlements in dev builds, addon load failures on non-macOS CI) from breaking existing secret functionality.

### 6. `CFRef<T>` RAII wrapper for CoreFoundation objects

CoreFoundation objects must be `CFRelease`d. The addon uses a `CFRef<T>` template class for RAII. When setting into CF dictionaries, uses `.get()` (not `.release()`) so the RAII wrapper's destructor balances the create while `CFDictionarySetValue` retains its own +1 reference. An earlier version using `.release()` caused refcount leaks.

### 7. Security hardening in native addon

- **Secret zeroing**: `secureClear()` uses a `volatile char*` to zero `std::string` buffers
- **Build flags**: `-D_FORTIFY_SOURCE=2`, `-Wformat`, `-Wformat-security`, `-fstack-protector-strong`
- **Error sanitization**: account/service names omitted from error messages
- **Input bounds**: values capped at 100 KB, strings at 1 KB
- **NUL byte rejection**: all string arguments validated

### 8. Platform guard in SharedKeychainMainService

The service checks `isMacintosh && !!productService.darwinSharedKeychainServiceName` at construction time. If either is false, all methods are no-ops. This means:
- On Windows/Linux: no keychain operations attempted
- On macOS without `darwinSharedKeychainServiceName` in product.json: no keychain operations (but this shouldn't happen in practice since Code OSS sets it)

### 9. `type !== 'in-memory'` guard in NativeSecretStorageService

Shared keychain operations are skipped when `this.type === 'in-memory'` (encryption unavailable). The type can be `'unknown'` during initialization before encryption availability is determined — shared keychain operations proceed for both `'persisted'` and `'unknown'` states.

## Testing strategy

### Unit tests
- Run existing `BaseSecretStorageService` tests to verify the `_doGet`/`_doSet`/`_doDelete`/`_doGetKeys` refactoring didn't break anything:
  ```bash
  ./scripts/test.sh --run src/vs/platform/secrets/test/common/secrets.test.ts
  ```

### Compilation check
```bash
npm run compile-check-ts-native
```

### Manual E2E flow
1. Launch Code OSS: `./scripts/code.sh`
2. Sign in to GitHub/Microsoft
3. Verify Keychain Access shows entries under `com.visualstudio.code.oss.shared-secrets`
4. Launch Agents: `./scripts/code.sh --agents --user-data-dir=$HOME/.vscode-oss-sessions-dev --extensions-dir=$HOME/.vscode-oss-sessions-dev/extensions`
5. Verify the Agents app is signed in without re-authentication

### Edge cases
- Cold start with no prior secrets (no migration needed)
- Restart after migration (flag set, migration skips)
- Delete a secret in Code → verify it's gone from both keychain and SQLite
- Multiple windows restoring simultaneously (benign concurrent migration)

## Open questions (from spec)

1. ~~**Naming convention for keychain items**~~ → Resolved: `darwinSharedKeychainServiceName` in product.json, per-flavor
2. **Entitlement signing**: Does adding `keychain-access-groups` to `app-entitlements.plist` require CI/CD signing process changes? Needs verification with the build team.
3. **Notification/sync**: When Code writes a new secret, should the Agents app be notified in real-time? Currently read-on-demand (lazy).
4. **Scope**: Currently shares ALL secrets. May want to filter to auth-related only in the future.

## Phase 2 (Windows) and Phase 3 (Linux) — future work

Not started. See spec for approach:
- **Windows**: Cross-read Code's SQLite + same DPAPI key (user-scoped, not app-scoped). Must avoid CredMan for secret values (2.5KB size limit).
- **Linux**: Similar to Windows — keyring services are user-scoped.
