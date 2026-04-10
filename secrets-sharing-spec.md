# Secrets Sharing Between VS Code and Agents App

**Issue**: https://github.com/microsoft/vscode/issues/308028
**Related**: https://github.com/microsoft/vscode/issues/308353
**Assignees**: alexdima, deepak1556
**Stakeholders**: Tyler Leonhardt (auth team), Kai (requested the work)

## Problem Statement

The Agents app is a standalone application bundled inside VS Code. When a user is already authenticated in VS Code (e.g., signed into GitHub, Microsoft account), they must re-authenticate in the Agents app because the two apps have completely isolated secret stores. This is a friction point for onboarding — users expect to be signed in automatically.

## Current Architecture

### How secrets are stored today

The secret storage pipeline has three layers:

#### Layer 1: Encryption via Electron's `safeStorage`

**File**: `src/vs/platform/encryption/electron-main/encryptionMainService.ts`

`EncryptionMainService` wraps Electron's `safeStorage` API:
- `safeStorage.encryptString(value)` — encrypts a string using an OS-managed encryption key
- `safeStorage.decryptString(buffer)` — decrypts it back

On macOS, Electron stores the encryption key in the **macOS Keychain** under the app's own name (derived from `CFBundleName`). On macOS, `getKeyStorageProvider()` returns `KnownStorageProvider.keychainAccess`.

The encrypted values are JSON-serialized `Buffer` objects (e.g., `{"data": "..."}`).

#### Layer 2: Secret storage service (encrypt-then-store in SQLite)

**File**: `src/vs/platform/secrets/common/secrets.ts`

`BaseSecretStorageService` stores secrets with a `secret://` key prefix in `IStorageService` (a SQLite database scoped to `StorageScope.APPLICATION`):

- **`set(key, value)`**: Encrypts `value` via `IEncryptionService.encrypt()`, then stores the ciphertext in SQLite under the key `secret://<key>`.
- **`get(key)`**: Reads the ciphertext from SQLite under `secret://<key>`, then decrypts via `IEncryptionService.decrypt()`.
- **`delete(key)`**: Removes the entry from SQLite.
- **`keys()`**: Lists all `secret://`-prefixed keys from SQLite.

The desktop override is `NativeSecretStorageService` in `src/vs/workbench/services/secrets/electron-browser/secretStorageService.ts`, which adds user notifications for cases where encryption is unavailable.

#### Layer 3: Extension API

Extensions use `vscode.ExtensionContext.secrets.store(key, value)` / `.get(key)`, which delegates to `ISecretStorageService`. Example: `extensions/github-authentication/src/common/keychain.ts`.

### How the two apps are deployed

On macOS, the Agents app is a **nested `.app` bundle** inside the main Code `.app`:

```
Code.app/
  Contents/
    Applications/
      <AgentsNameShort>.app    ← separate bundle, own bundle ID, own Dock icon
```

This is configured in `build/gulpfile.vscode.ts` using metadata from `product.json`'s `embedded` key (typed as `EmbeddedProductInfo` in `build/lib/embeddedType.ts`):

```typescript
export type EmbeddedProductInfo = {
    nameShort: string;
    nameLong: string;
    applicationName: string;
    dataFolderName: string;           // ← separate data directory
    darwinBundleIdentifier: string;   // ← separate bundle ID
    urlProtocol: string;
    // ... win32 fields
};
```

When the Agents `.app` launches, it runs its **own Electron main process** with `process.isEmbeddedApp = true`. It has its own Dock icon, bundle identifier, URL protocol, and data folder. See `src/vs/code/electron-main/app.ts` — when `isEmbeddedApp` is true, it calls `openAgentsWindow()` which opens a `BrowserWindow` loading `sessions.html` instead of `workbench.html`.

The Agents window can also be opened within Code's process via the `--agents` flag (development/insider only), in which case it's just another `BrowserWindow` in the same Electron main process.

### Why secrets are currently isolated (two barriers)

#### Barrier 1: Encryption key isolation (macOS)

Electron's `safeStorage` stores its encryption key in the macOS Keychain under the **app's own `CFBundleName`**. Code's keychain item has a name like `"Code"` or `"Code - Insiders"`, while the Agents app would have its own name (e.g., `"Agents"`). These are **separate keychain items with separate encryption keys**. The Agents app cannot read Code's encryption key, and vice versa. The `safeStorage` API has no concept of shared access groups.

#### Barrier 2: Storage database isolation (all platforms)

Each app has its own `dataFolderName` (from the `embedded` product config), so the SQLite databases where encrypted secrets live are in **completely separate directories** (e.g., `~/Library/Application Support/Code/` vs `~/Library/Application Support/Agents/`). Even if the two apps could use the same encryption key, they wouldn't find each other's stored ciphertext.

### How the Agents app currently uses secrets

The Agents app (`src/vs/sessions/`) imports the same `NativeSecretStorageService` as Code:
- `src/vs/sessions/sessions.desktop.main.ts` imports `../workbench/services/secrets/electron-browser/secretStorageService.js`

So it goes through the exact same encrypt-then-store-in-SQLite pipeline, but with its own encryption key and its own SQLite database.

## Team Discussion Summary

### Tyler Leonhardt (auth team) confirmed:

1. The current-state analysis above is correct.
2. He prefers a "shared keychain" concept over a backdoor into VS Code's secrets.
3. **Critical warning for Windows**: Windows CredMan has a **~2.5 KB blob size limit** per credential. A single Microsoft auth refresh token already exceeds this limit. This is why Electron stores only the small encryption key in the credential store and puts the actual (large) encrypted secrets in SQLite. **Do not attempt to store secrets directly in CredMan on Windows.**

### deepak1556 (Electron/platform team) recommended:

1. **macOS**: Use Apple's [Keychain Access Groups](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps) — the official mechanism for sharing keychain items between apps signed by the same team. Since Electron's `safeStorage` API has no concept of access groups, **build a native Node.js addon** (Objective-C) rather than waiting on Electron/Chromium changes.
2. **Windows**: DPAPI is user-scoped, not app-scoped — any process running as the same user can already encrypt/decrypt with the same key. The only barrier is the separate SQLite databases. However, app-bound encryption (per-app isolation) is a concept from Chromium that could complicate this in the future; we don't use it today.

## Proposed Solution (macOS first)

### Design Principles

1. **Don't change how Code stores secrets for existing users** — millions of installations have secrets in the current format (safeStorage + SQLite). The new mechanism must coexist with the old one.
2. **Migration must be re-entrant** — if we find a critical problem, we can roll back. Re-running migration should be safe (idempotent).
3. **macOS first, then Windows/Linux** — macOS is the most complex case (true app-level keychain isolation). Windows and Linux are simpler.
4. **Native addon, no Electron changes required** — deepak1556's recommendation. Keeps us in control of the timeline.

### macOS: Native Node Addon with Shared Keychain Access Group

#### Why store directly in Keychain on macOS?

macOS Keychain (`kSecClassGenericPassword`) does **not** have the blob size limitations that Windows CredMan has. Large values (auth tokens, etc.) can be stored directly as keychain items. This eliminates the need for a separate SQLite database for shared secrets, which is a major simplification — no need to coordinate database locations or cross-read another app's SQLite file.

#### Keychain access groups (Apple mechanism)

From [Apple's documentation](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps):

- Every app has a default access group equal to its **app ID** (`$(TeamID).$(BundleID)`), making its keychain items private by default.
- Apps signed by the same team can share keychain items by adding a common **keychain access group** to both apps' entitlements via the `keychain-access-groups` entitlement.
- Each keychain item belongs to exactly one access group (set via `kSecAttrAccessGroup` when creating the item).
- When searching, you can specify `kSecAttrAccessGroup` to limit the search, or omit it to search all groups your app belongs to.

#### Entitlements

Both `Code.app` and `Agents.app` need the same keychain access group in their entitlements:

```xml
<key>keychain-access-groups</key>
<array>
    <string>$(TeamIdentifierPrefix)com.microsoft.vscode.shared-secrets</string>
</array>
```

Adding a keychain access group to entitlements is **backward-compatible** — it does not affect existing keychain items stored under the app's default access group. Existing safeStorage-managed items remain accessible.

#### Native addon API

Build a native Node.js addon (C/Objective-C) that wraps the macOS Security framework:

```
// Conceptual API:
keychainSet(service: string, account: string, value: string, accessGroup: string): void
keychainGet(service: string, account: string, accessGroup: string): string | undefined
keychainDelete(service: string, account: string, accessGroup: string): void
keychainList(service: string, accessGroup: string): string[]  // returns account names
```

Internally uses `SecItemAdd`, `SecItemCopyMatching`, `SecItemUpdate`, `SecItemDelete` with:
- `kSecClass`: `kSecClassGenericPassword`
- `kSecAttrService`: A agreed-upon service name, e.g. `"com.microsoft.vscode.shared-secrets"`
- `kSecAttrAccount`: The secret key (e.g., `"github.auth"`)
- `kSecAttrAccessGroup`: `"<TeamID>.com.microsoft.vscode.shared-secrets"`
- `kSecValueData`: The secret value (UTF-8 encoded)
- `kSecUseDataProtectionKeychain`: `true` (required for access groups on macOS)

#### Service architecture

A new `ISharedSecretStorageService` (or an alternative `ISecretStorageService` implementation) that:

1. On **write**: Stores the secret directly in macOS Keychain using the native addon with the shared access group. Also notifies the old `ISecretStorageService` pipeline to keep the local copy in sync (for rollback safety).
2. On **read**: Reads from the shared keychain via the native addon. Falls back to the old pipeline if not found (pre-migration secrets).
3. On **delete**: Deletes from both the shared keychain and the old pipeline.

#### Migration

A one-time, re-entrant migration runs in **both** Code and the Agents app on startup:

**In Code (the primary migration source)**:
1. Read all `secret://`-prefixed keys from `IStorageService` (SQLite).
2. For each key, decrypt using the existing `safeStorage`-based `IEncryptionService`.
3. Write the decrypted value to the shared keychain using the native addon.
4. Mark the migration as complete in a storage flag.

**Re-entrancy**: The migration can be run multiple times safely. Writing to the keychain is idempotent (if the item already exists with the same value, it's a no-op or update). If a critical issue is found, the old storage still has all secrets untouched — we can remove the shared keychain code path and fall back.

**In the Agents app**: Reads from the shared keychain directly. No migration needed from the Agents side — it just needs to find the secrets Code put there.

### Data flow (macOS, after migration)

```
Extension calls context.secrets.get("github.auth")
    → ISecretStorageService.get("github.auth")
        → [new path] Native addon: SecItemCopyMatching(
            service: "com.microsoft.vscode.shared-secrets",
            account: "github.auth",
            accessGroup: "<TeamID>.com.microsoft.vscode.shared-secrets"
          )
        → Returns plaintext secret directly from keychain
        → (no SQLite, no encrypt/decrypt needed — keychain IS the secure storage)
```

### Comparison: old vs. new (macOS)

| Aspect | Old (safeStorage + SQLite) | New (shared keychain) |
|--------|---------------------------|----------------------|
| Encryption key | Per-app, in Keychain, managed by Electron | Not needed — Keychain itself is the secure store |
| Secret storage | Encrypted ciphertext in per-app SQLite | Plaintext in Keychain, protected by OS |
| Cross-app access | Impossible | Via shared `keychain-access-groups` entitlement |
| Size limits | None (SQLite) | None on macOS Keychain |
| Native code needed | No (Electron handles it) | Yes (native Node addon) |

## Windows Strategy (future work)

**Important constraint from Tyler**: Windows CredMan has a ~2.5 KB limit per credential — a single Microsoft auth refresh token exceeds this. This is why Electron chose to store only the encryption key (small) in the OS credential store, rather than the actual secrets. **Do not store secrets directly in CredMan.**

### Current Windows state (from deepak1556)

On Windows, when using `safeStorage` today, the DPAPI encryption keys are stored to a **file** under the user data directory after base64 encoding. There is **no protection between app processes for the same user on Windows** — any app running as the same user can read this file. This also applies to Windows Credential Manager (same process and user scope as DPAPI). This is why Chrome had to invent their own app-bound encryption to isolate secrets per app.

### Likely approach: Cross-read Code's storage

Since both the encryption key file and the SQLite database are just files under the user data directory, the Agents app can:

1. **Read Code's DPAPI encryption key file** from Code's user data directory (the key is base64-encoded in a file, readable by any same-user process).
2. **Read Code's SQLite database** to find `secret://`-prefixed entries.
3. **Decrypt the ciphertext** using the encryption key — or equivalently, use `safeStorage.decryptString()` if within the same Electron process, since DPAPI is user-scoped.

The Agents app needs to know Code's `dataFolderName` path, which is available from the parent app's `product.json` or can be derived from the `embedded` configuration.

**Note**: Chromium has app-bound encryption on Windows that isolates secrets per app, but VS Code does not use this today. If it's adopted in the future, the cross-reading approach would break and would need revisiting. Deepak will provide more details when work begins on Windows.

## Linux Strategy (future work)

Similar to Windows — keyring services (gnome-keyring, kwallet) are user-scoped, not app-scoped. The Agents app should be able to cross-read Code's SQLite database and decrypt with its own `safeStorage` call. The same `dataFolderName` cross-referencing approach applies.

## Files Involved

| File | Role |
|------|------|
| `src/vs/platform/encryption/common/encryptionService.ts` | `IEncryptionService` interface, `KnownStorageProvider` enum |
| `src/vs/platform/encryption/electron-main/encryptionMainService.ts` | `EncryptionMainService` — wraps `electron.safeStorage` |
| `src/vs/platform/secrets/common/secrets.ts` | `BaseSecretStorageService` — encrypt-then-store in SQLite |
| `src/vs/workbench/services/secrets/electron-browser/secretStorageService.ts` | `NativeSecretStorageService` — desktop override with notifications |
| `src/vs/sessions/sessions.desktop.main.ts` | Agents app entry point — imports secretStorageService |
| `src/vs/code/electron-main/app.ts` | Main process — `isEmbeddedApp` handling, `registerEmbeddedAppWithLaunchServices` |
| `build/lib/embeddedType.ts` | `EmbeddedProductInfo` type (bundle ID, data folder, etc.) |
| `build/gulpfile.vscode.ts` | macOS packaging — `darwinMiniAppName`, `darwinMiniAppBundleIdentifier`, etc. |
| `extensions/github-authentication/src/common/keychain.ts` | Example extension using `context.secrets` |

## Implementation Plan

### Phase 1: macOS shared keychain (starting here)

1. **Native addon**: Create a macOS-specific native Node.js addon that wraps `SecItemAdd`/`SecItemCopyMatching`/`SecItemUpdate`/`SecItemDelete` with access group support.
   - Location: `src/vs/platform/encryption/electron-main/darwin/` (or similar)
   - Must handle: UTF-8 encoding, error codes, item-not-found vs. real errors, updating existing items

2. **Entitlements**: Add `keychain-access-groups` entitlement to both Code and Agents app builds.
   - Location: `build/darwin/` entitlements files

3. **New service**: Create a shared-keychain-backed `ISecretStorageService` implementation for macOS.
   - Reads/writes directly to Keychain with the shared access group
   - Falls back to old safeStorage+SQLite path if keychain read fails

4. **Migration logic**: In Code, on startup, migrate existing secrets to the shared keychain.
   - Read all `secret://` keys from SQLite
   - Decrypt each with safeStorage
   - Write plaintext to shared keychain via native addon
   - Store a "migration complete" flag
   - Must be idempotent / re-entrant

5. **Testing**: Test with real auth tokens (Microsoft account refresh tokens are large — this was the CredMan problem on Windows, but macOS Keychain should handle it fine). Test both directions: Code writes, Agents reads; verify sign-in state is shared.

### Phase 2: Windows (future)

- Evaluate the approaches listed above with deepak1556
- Likely: cross-read Code's SQLite + same DPAPI key
- Must avoid CredMan for secret values (size limit)

### Phase 3: Linux (future)

- Similar to Windows approach
- Test with gnome-keyring and kwallet backends

## Open Questions

1. **Naming convention for keychain items**: What `kSecAttrService` value to use? Needs to be stable across versions.
2. **Entitlement signing**: Does adding `keychain-access-groups` require any changes to the CI/CD signing process?
3. **App-bound encryption on Windows**: If Chromium/Electron adopts this in the future, what's the fallback plan?
4. **Notification/sync**: When Code writes a new secret, should the Agents app be notified in real-time? Or is read-on-demand sufficient?
5. **Scope**: Should we share ALL secrets, or only auth-related ones? Sharing all is simpler but may have unintended consequences.
