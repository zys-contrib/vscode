/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Usage: node scripts/reset-cross-app-secret-migration.js
//
// Removes the `crossAppSecretSharing.migrationDone` flag from both the
// VS Code and Agents app state files so the migration will run again
// on next startup. Both apps must be closed before running this.

const fs = require('fs');
const path = require('path');
const os = require('os');

const KEY = 'crossAppSecretSharing.migrationDone';

const stateFiles = [
	path.join(os.homedir(), 'Library/Application Support/Code - Insiders/User/globalStorage/storage.json'),
	path.join(os.homedir(), 'Library/Application Support/Agents - Insiders/User/globalStorage/storage.json'),
];

let changed = 0;

for (const filePath of stateFiles) {
	try {
		const content = fs.readFileSync(filePath, 'utf8');
		const state = JSON.parse(content);

		if (KEY in state) {
			delete state[KEY];
			fs.writeFileSync(filePath, JSON.stringify(state, null, '\t'), 'utf8');
			console.log(`✓ Removed '${KEY}' from ${filePath}`);
			changed++;
		} else {
			console.log(`- '${KEY}' not found in ${filePath}`);
		}
	} catch (err) {
		if (err.code === 'ENOENT') {
			console.log(`- File not found: ${filePath}`);
		} else {
			// allow-any-unicode-next-line
			console.error(`✗ Error processing ${filePath}: ${err.message}`);
		}
	}
}

if (changed > 0) {
	console.log(`\nDone. Reset ${changed} file(s). You can now relaunch the Agents app to trigger migration again.`);
} else {
	console.log('\nNothing to reset. Migration flag was not set in any file.');
}
