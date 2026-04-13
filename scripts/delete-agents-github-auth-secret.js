/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Usage: node scripts/delete-agents-github-auth-secret.js
//
// Deletes the github.auth secret from the Agents app's storage database
// so that it will be re-fetched from VS Code via crossAppIPC on next startup.
// The Agents app must be closed before running this.

const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');

const SECRET_KEY = 'secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}';

const dbPath = path.join(os.homedir(), 'Library/Application Support/Agents - Insiders/User/globalStorage/state.vscdb');

try {
	// Check if the key exists
	const check = execFileSync('sqlite3', [dbPath, `SELECT key FROM ItemTable WHERE key = '${SECRET_KEY}'`], { encoding: 'utf8' }).trim();

	if (check) {
		execFileSync('sqlite3', [dbPath, `DELETE FROM ItemTable WHERE key = '${SECRET_KEY}'`]);
		console.log(`✓ Deleted '${SECRET_KEY}' from ${dbPath}`);
	} else {
		console.log(`- Secret not found in ${dbPath}`);
	}
} catch (err) {
	if (err.code === 'ENOENT') {
		// allow-any-unicode-next-line
		console.error('✗ sqlite3 command not found. Please install sqlite3.');
	} else {
		// allow-any-unicode-next-line
		console.error(`✗ Error: ${err.message}`);
	}
}
