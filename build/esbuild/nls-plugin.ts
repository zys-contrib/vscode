/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';
import {
	TextModel,
	analyzeLocalizeCalls,
	parseLocalizeKeyOrValue
} from '../lib/nls-analysis.ts';

// ============================================================================
// Types
// ============================================================================

interface NLSEntry {
	moduleId: string;
	key: string | { key: string; comment: string[] };
	message: string;
	placeholder: string;
}

export interface NLSPluginOptions {
	/**
	 * Base path for computing module IDs (e.g., 'src')
	 */
	baseDir: string;

	/**
	 * Shared collector for NLS entries across multiple builds.
	 * Create with createNLSCollector() and pass to multiple plugin instances.
	 */
	collector: NLSCollector;
}

/**
 * Collector for NLS entries across multiple esbuild builds.
 */
export interface NLSCollector {
	entries: Map<string, NLSEntry>;
	add(entry: NLSEntry): void;
}

/**
 * Creates a shared NLS collector that can be passed to multiple plugin instances.
 */
export function createNLSCollector(): NLSCollector {
	const entries = new Map<string, NLSEntry>();
	return {
		entries,
		add(entry: NLSEntry) {
			entries.set(entry.placeholder, entry);
		}
	};
}

/**
 * Finalizes NLS collection and writes output files.
 * Call this after all esbuild builds have completed.
 */
export async function finalizeNLS(
	collector: NLSCollector,
	outDir: string
): Promise<{ indexMap: Map<string, number>; messageCount: number }> {
	if (collector.entries.size === 0) {
		return { indexMap: new Map(), messageCount: 0 };
	}

	// Sort entries by moduleId, then by key for stable indices
	const sortedEntries = [...collector.entries.values()].sort((a, b) => {
		const aKey = typeof a.key === 'string' ? a.key : a.key.key;
		const bKey = typeof b.key === 'string' ? b.key : b.key.key;
		const moduleCompare = a.moduleId.localeCompare(b.moduleId);
		if (moduleCompare !== 0) {
			return moduleCompare;
		}
		return aKey.localeCompare(bKey);
	});

	// Create index map
	const indexMap = new Map<string, number>();
	sortedEntries.forEach((entry, idx) => {
		indexMap.set(entry.placeholder, idx);
	});

	// Build NLS metadata
	const allMessages: string[] = [];
	const moduleToKeys: Map<string, (string | { key: string; comment: string[] })[]> = new Map();
	const moduleToMessages: Map<string, string[]> = new Map();

	for (const entry of sortedEntries) {
		allMessages.push(entry.message);

		if (!moduleToKeys.has(entry.moduleId)) {
			moduleToKeys.set(entry.moduleId, []);
			moduleToMessages.set(entry.moduleId, []);
		}
		moduleToKeys.get(entry.moduleId)!.push(entry.key);
		moduleToMessages.get(entry.moduleId)!.push(entry.message);
	}

	// nls.keys.json: [["moduleId", ["key1", "key2"]], ...]
	const nlsKeysJson: [string, string[]][] = [];
	for (const [moduleId, keys] of moduleToKeys) {
		nlsKeysJson.push([moduleId, keys.map(k => typeof k === 'string' ? k : k.key)]);
	}

	// nls.metadata.json: { keys: {...}, messages: {...} }
	const nlsMetadataJson = {
		keys: Object.fromEntries(moduleToKeys),
		messages: Object.fromEntries(moduleToMessages)
	};

	// Write NLS files
	await fs.promises.mkdir(outDir, { recursive: true });

	await Promise.all([
		fs.promises.writeFile(
			path.join(outDir, 'nls.messages.json'),
			JSON.stringify(allMessages)
		),
		fs.promises.writeFile(
			path.join(outDir, 'nls.keys.json'),
			JSON.stringify(nlsKeysJson)
		),
		fs.promises.writeFile(
			path.join(outDir, 'nls.metadata.json'),
			JSON.stringify(nlsMetadataJson, null, '\t')
		),
		fs.promises.writeFile(
			path.join(outDir, 'nls.messages.js'),
			`/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
globalThis._VSCODE_NLS_MESSAGES=${JSON.stringify(allMessages)};`
		)
	]);

	console.log(`[nls] Extracted ${allMessages.length} messages from ${moduleToKeys.size} modules`);

	return { indexMap, messageCount: allMessages.length };
}

/**
 * Post-processes a JavaScript file to replace NLS placeholders with indices.
 */
export function postProcessNLS(
	content: string,
	indexMap: Map<string, number>,
	preserveEnglish: boolean
): string {
	return replaceInOutput(content, indexMap, preserveEnglish);
}

// ============================================================================
// Transformation
// ============================================================================

function transformToPlaceholders(
	source: string,
	moduleId: string
): { code: string; entries: NLSEntry[] } {
	const localizeCalls = analyzeLocalizeCalls(source, 'localize');
	const localize2Calls = analyzeLocalizeCalls(source, 'localize2');
	const allCalls = [...localizeCalls, ...localize2Calls].sort(
		(a, b) => a.keySpan.start.line - b.keySpan.start.line ||
			a.keySpan.start.character - b.keySpan.start.character
	);

	if (allCalls.length === 0) {
		return { code: source, entries: [] };
	}

	const entries: NLSEntry[] = [];
	const model = new TextModel(source);

	// Process in reverse order to preserve positions
	for (const call of allCalls.reverse()) {
		const keyParsed = parseLocalizeKeyOrValue(call.key) as string | { key: string; comment: string[] };
		const messageParsed = parseLocalizeKeyOrValue(call.value);
		const keyString = typeof keyParsed === 'string' ? keyParsed : keyParsed.key;

		// Create a deterministic placeholder
		const placeholder = `%%NLS:${moduleId}#${keyString}%%`;

		entries.push({
			moduleId,
			key: keyParsed,
			message: String(messageParsed),
			placeholder
		});

		// Replace the key with the placeholder string
		model.apply(call.keySpan, `"${placeholder}"`);
	}

	// Reverse entries to match source order
	entries.reverse();

	return { code: model.toString(), entries };
}

function replaceInOutput(
	content: string,
	indexMap: Map<string, number>,
	preserveEnglish: boolean
): string {
	// Replace all placeholders in a single pass using a regex that matches any placeholder
	// Pattern: "%%NLS:moduleId#key%%"

	if (preserveEnglish) {
		// Just replace the placeholder with the index
		return content.replace(/"%%NLS:([^%]+)%%"/g, (match, inner) => {
			const placeholder = `%%NLS:${inner}%%`;
			const index = indexMap.get(placeholder);
			if (index !== undefined) {
				return String(index);
			}
			// Placeholder not found in map, leave as-is (shouldn't happen)
			return match;
		});
	} else {
		// Replace placeholder with index AND replace message with null
		// Pattern: "%%NLS:...%%", "message" (or 'message' or `message`)
		return content.replace(
			/"%%NLS:([^%]+)%%"(\s*,\s*)(?:"[^"]*"|'[^']*'|`[^`]*`)/g,
			(match, inner, comma) => {
				const placeholder = `%%NLS:${inner}%%`;
				const index = indexMap.get(placeholder);
				if (index !== undefined) {
					return `${index}${comma}null`;
				}
				// Placeholder not found in map, leave as-is (shouldn't happen)
				return match;
			}
		);
	}
}

// ============================================================================
// Plugin
// ============================================================================

export function nlsPlugin(options: NLSPluginOptions): esbuild.Plugin {
	const { collector } = options;

	return {
		name: 'nls',
		setup(build) {
			// Transform TypeScript files to replace localize() calls with placeholders
			build.onLoad({ filter: /\.ts$/ }, async (args) => {
				// Skip .d.ts files
				if (args.path.endsWith('.d.ts')) {
					return undefined;
				}

				const source = await fs.promises.readFile(args.path, 'utf-8');

				// Compute module ID (e.g., "vs/editor/editor" from "src/vs/editor/editor.ts")
				const relativePath = path.relative(options.baseDir, args.path);
				const moduleId = relativePath
					.replace(/\\/g, '/')
					.replace(/\.ts$/, '');

				// Transform localize() calls to placeholders
				const { code, entries: fileEntries } = transformToPlaceholders(source, moduleId);

				// Collect entries
				for (const entry of fileEntries) {
					collector.add(entry);
				}

				if (fileEntries.length > 0) {
					return { contents: code, loader: 'ts' };
				}

				// No NLS calls, return undefined to let esbuild handle normally
				return undefined;
			});
		}
	};
}
