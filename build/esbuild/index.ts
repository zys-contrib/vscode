/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import glob from 'glob';
import * as watcher from '@parcel/watcher';
import { nlsPlugin, createNLSCollector, finalizeNLS, postProcessNLS } from './nls-plugin.ts';

const globAsync = promisify(glob);

// ============================================================================
// Configuration
// ============================================================================

const REPO_ROOT = path.dirname(path.dirname(import.meta.dirname));

// CLI: transpile [--watch] | bundle [--minify] [--nls]
const command = process.argv[2]; // 'transpile' or 'bundle'
const options = {
	watch: process.argv.includes('--watch'),
	minify: process.argv.includes('--minify'),
	nls: process.argv.includes('--nls'),
};

const SRC_DIR = 'src';
const OUT_DIR = 'out';
const OUT_VSCODE_DIR = 'out-vscode';

// UTF-8 BOM - added to test files with 'utf8' in the path (matches gulp build behavior)
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// ============================================================================
// Entry Points (from build/buildfile.ts)
// ============================================================================

const workerEntryPoints = [
	'vs/editor/common/services/editorWebWorkerMain',
	'vs/workbench/api/worker/extensionHostWorkerMain',
	'vs/workbench/contrib/notebook/common/services/notebookWebWorkerMain',
	'vs/workbench/services/languageDetection/browser/languageDetectionWebWorkerMain',
	'vs/workbench/services/search/worker/localFileSearchMain',
	'vs/platform/profiling/electron-browser/profileAnalysisWorkerMain',
	'vs/workbench/contrib/output/common/outputLinkComputerMain',
	'vs/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain',
];

const desktopEntryPoints = [
	'vs/workbench/workbench.desktop.main',
	'vs/workbench/contrib/debug/node/telemetryApp',
	'vs/platform/files/node/watcher/watcherMain',
	'vs/platform/terminal/node/ptyHostMain',
	'vs/workbench/api/node/extensionHostProcess',
];

const codeEntryPoints = [
	'vs/code/node/cliProcessMain',
	'vs/code/electron-utility/sharedProcess/sharedProcessMain',
	'vs/code/electron-browser/workbench/workbench',
];

const webEntryPoints = [
	'vs/workbench/workbench.web.main.internal',
	'vs/code/browser/workbench/workbench',
];

const keyboardMapEntryPoints = [
	'vs/workbench/services/keybinding/browser/keyboardLayouts/layout.contribution.linux',
	'vs/workbench/services/keybinding/browser/keyboardLayouts/layout.contribution.darwin',
	'vs/workbench/services/keybinding/browser/keyboardLayouts/layout.contribution.win',
];

const bootstrapEntryPoints = [
	'main',
	'cli',
	'bootstrap-fork',
	'server-main',
	'server-cli',
];

// ============================================================================
// Resource Patterns (files to copy, not transpile/bundle)
// ============================================================================

const resourcePatterns = [
	// HTML
	'vs/code/electron-browser/workbench/workbench.html',
	'vs/code/electron-browser/workbench/workbench-dev.html',
	'vs/code/browser/workbench/workbench.html',
	'vs/code/browser/workbench/workbench-dev.html',
	'vs/code/browser/workbench/callback.html',
	'vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html',
	'vs/workbench/contrib/webview/browser/pre/*.html',

	// Fonts
	'vs/base/browser/ui/codicons/codicon/codicon.ttf',

	// Vendor JavaScript libraries (not transpiled)
	'vs/base/common/marked/marked.js',
	'vs/base/common/semver/semver.js',
	'vs/base/browser/dompurify/dompurify.js',

	// Electron preload (not bundled)
	'vs/base/parts/sandbox/electron-browser/preload.js',
	'vs/base/parts/sandbox/electron-browser/preload-aux.js',

	// Webview pre scripts
	'vs/workbench/contrib/webview/browser/pre/*.js',

	// Shell scripts
	'vs/base/node/*.sh',
	'vs/workbench/contrib/terminal/common/scripts/**/*.sh',
	'vs/workbench/contrib/terminal/common/scripts/**/*.ps1',
	'vs/workbench/contrib/terminal/common/scripts/**/*.psm1',
	'vs/workbench/contrib/terminal/common/scripts/**/*.fish',
	'vs/workbench/contrib/terminal/common/scripts/**/*.zsh',
	'vs/workbench/contrib/externalTerminal/**/*.scpt',

	// Media - audio
	'vs/platform/accessibilitySignal/browser/media/*.mp3',

	// Media - images
	'vs/workbench/contrib/welcomeGettingStarted/common/media/**/*.svg',
	'vs/workbench/contrib/welcomeGettingStarted/common/media/**/*.png',
	'vs/workbench/contrib/extensions/browser/media/*.svg',
	'vs/workbench/contrib/extensions/browser/media/*.png',
	'vs/workbench/services/extensionManagement/common/media/*.svg',
	'vs/workbench/services/extensionManagement/common/media/*.png',
	'vs/workbench/browser/parts/editor/media/*.png',
	'vs/workbench/contrib/debug/browser/media/*.png',

	// Tree-sitter queries
	'vs/editor/common/languages/highlights/*.scm',
	'vs/editor/common/languages/injections/*.scm',
];

// Test fixtures (only copied for development builds, not production)
const testFixturePatterns = [
	'**/test/**/*.json',
	'**/test/**/*.txt',
	'**/test/**/*.snap',
	'**/test/**/*.tst',
	'**/test/**/*.html',
	'**/test/**/*.js',
	'**/test/**/*.jxs',
	'**/test/**/*.tsx',
	'**/test/**/*.css',
	'**/test/**/*.png',
	'**/test/**/*.md',
	'**/test/**/*.zip',
	'**/test/**/*.pdf',
	'**/test/**/*.qwoff',
	'**/test/**/*.wuff',
	'**/test/**/*.less',
	// Files without extensions (executables, etc.)
	'**/test/**/fixtures/executable/*',
];

// ============================================================================
// Utilities
// ============================================================================

async function cleanDir(dir: string): Promise<void> {
	const fullPath = path.join(REPO_ROOT, dir);
	console.log(`[clean] ${dir}`);
	await fs.promises.rm(fullPath, { recursive: true, force: true });
	await fs.promises.mkdir(fullPath, { recursive: true });
}

/**
 * Only used to make encoding tests happy. The source files don't have a BOM but the
 * tests expect one... so we add it here.
 */
function needsBomAdded(filePath: string): boolean {
	return /([\/\\])test\1.*utf8/.test(filePath);
}

async function copyFile(srcPath: string, destPath: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

	if (needsBomAdded(srcPath)) {
		const content = await fs.promises.readFile(srcPath);
		if (content[0] !== 0xef || content[1] !== 0xbb || content[2] !== 0xbf) {
			await fs.promises.writeFile(destPath, Buffer.concat([UTF8_BOM, content]));
			return;
		}
	}
	await fs.promises.copyFile(srcPath, destPath);
}

async function copyCssFiles(outDir: string, excludeTests = false): Promise<number> {
	// Copy all CSS files from src to output (they're imported by JS)
	const cssFiles = await globAsync('**/*.css', {
		cwd: path.join(REPO_ROOT, SRC_DIR),
		ignore: excludeTests ? ['**/test/**'] : [],
	});

	for (const file of cssFiles) {
		const srcPath = path.join(REPO_ROOT, SRC_DIR, file);
		const destPath = path.join(REPO_ROOT, outDir, file);

		await copyFile(srcPath, destPath);
	}

	return cssFiles.length;
}

async function copyResources(outDir: string, excludeDevFiles = false, excludeTests = false): Promise<void> {
	console.log(`[resources] Copying to ${outDir}...`);
	let copied = 0;

	const ignorePatterns: string[] = [];
	if (excludeTests) {
		ignorePatterns.push('**/test/**');
	}
	if (excludeDevFiles) {
		ignorePatterns.push('**/*-dev.html');
	}

	for (const pattern of resourcePatterns) {
		const files = await globAsync(pattern, {
			cwd: path.join(REPO_ROOT, SRC_DIR),
			ignore: ignorePatterns,
		});

		for (const file of files) {
			const srcPath = path.join(REPO_ROOT, SRC_DIR, file);
			const destPath = path.join(REPO_ROOT, outDir, file);

			await copyFile(srcPath, destPath);
			copied++;
		}
	}

	// Copy test fixtures (only for development builds)
	if (!excludeTests) {
		for (const pattern of testFixturePatterns) {
			const files = await globAsync(pattern, {
				cwd: path.join(REPO_ROOT, SRC_DIR),
			});

			for (const file of files) {
				const srcPath = path.join(REPO_ROOT, SRC_DIR, file);
				const destPath = path.join(REPO_ROOT, outDir, file);

				await copyFile(srcPath, destPath);
				copied++;
			}
		}
	}

	// Copy CSS files
	const cssCount = await copyCssFiles(outDir, excludeTests);
	copied += cssCount;

	console.log(`[resources] Copied ${copied} files (${cssCount} CSS)`);
}

// ============================================================================
// Plugins
// ============================================================================

function inlineMinimistPlugin(): esbuild.Plugin {
	return {
		name: 'inline-minimist',
		setup(build) {
			build.onResolve({ filter: /^minimist$/ }, () => ({
				path: path.join(REPO_ROOT, 'node_modules/minimist/index.js'),
				external: false,
			}));
		},
	};
}

function cssExternalPlugin(): esbuild.Plugin {
	// Mark CSS imports as external so they stay as import statements
	// The CSS files are copied separately and loaded by the browser at runtime
	return {
		name: 'css-external',
		setup(build) {
			build.onResolve({ filter: /\.css$/ }, (args) => ({
				path: args.path,
				external: true,
			}));
		},
	};
}

// ============================================================================
// Transpile (Goal 1: TS → JS using esbuild.transform for maximum speed)
// ============================================================================

// Shared transform options for single-file transpilation
const transformOptions: esbuild.TransformOptions = {
	loader: 'ts',
	format: 'esm',
	target: 'es2024',
	sourcemap: 'inline',
	sourcesContent: false,
	tsconfigRaw: JSON.stringify({
		compilerOptions: {
			experimentalDecorators: true,
			useDefineForClassFields: false
		}
	}),
};

async function transpileFile(srcPath: string, destPath: string, relativePath: string): Promise<void> {
	const source = await fs.promises.readFile(srcPath, 'utf-8');
	const result = await esbuild.transform(source, {
		...transformOptions,
		sourcefile: relativePath,
	});

	await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
	await fs.promises.writeFile(destPath, result.code);
}

async function transpile(outDir: string, excludeTests: boolean): Promise<void> {
	// Find all .ts files
	const ignorePatterns = ['**/*.d.ts'];
	if (excludeTests) {
		ignorePatterns.push('**/test/**');
	}

	const files = await globAsync('**/*.ts', {
		cwd: path.join(REPO_ROOT, SRC_DIR),
		ignore: ignorePatterns,
	});

	console.log(`[transpile] Found ${files.length} files`);

	// Transpile all files in parallel using esbuild.transform (fastest approach)
	await Promise.all(files.map(file => {
		const srcPath = path.join(REPO_ROOT, SRC_DIR, file);
		const destPath = path.join(REPO_ROOT, outDir, file.replace(/\.ts$/, '.js'));
		return transpileFile(srcPath, destPath, file);
	}));
}

// ============================================================================
// Bundle (Goal 2: JS → bundled JS)
// ============================================================================

async function bundle(doMinify: boolean, doNls: boolean): Promise<void> {
	await cleanDir(OUT_VSCODE_DIR);

	console.log(`[bundle] ${SRC_DIR} → ${OUT_VSCODE_DIR}${doMinify ? ' (minify)' : ''}${doNls ? ' (nls)' : ''}`);
	const t1 = Date.now();

	// Read TSLib for banner
	const tslibPath = path.join(REPO_ROOT, 'node_modules/tslib/tslib.es6.js');
	const tslib = await fs.promises.readFile(tslibPath, 'utf-8');
	const banner = {
		js: `/*!--------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
${tslib}`,
		css: `/*!--------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/`,
	};

	// Shared TypeScript options for bundling directly from source
	const tsconfigRaw = JSON.stringify({
		compilerOptions: {
			experimentalDecorators: true,
			useDefineForClassFields: false
		}
	});

	// Create shared NLS collector (only used if doNls is true)
	const nlsCollector = createNLSCollector();
	const preserveEnglish = false; // Production mode: replace messages with null

	// All entry points to bundle
	const allEntryPoints = [
		...workerEntryPoints,
		...desktopEntryPoints,
		...codeEntryPoints,
		...webEntryPoints,
		...keyboardMapEntryPoints,
	];

	// Collect all build results (with write: false)
	const buildResults: { outPath: string; result: esbuild.BuildResult }[] = [];

	// Bundle each entry point directly from TypeScript source
	await Promise.all(allEntryPoints.map(async (entryPoint) => {
		const entryPath = path.join(REPO_ROOT, SRC_DIR, `${entryPoint}.ts`);
		const outPath = path.join(REPO_ROOT, OUT_VSCODE_DIR, `${entryPoint}.js`);

		const plugins: esbuild.Plugin[] = [cssExternalPlugin()];
		if (doNls) {
			plugins.unshift(nlsPlugin({
				baseDir: path.join(REPO_ROOT, SRC_DIR),
				collector: nlsCollector,
			}));
		}

		const result = await esbuild.build({
			entryPoints: [entryPath],
			outfile: outPath,
			bundle: true,
			format: 'esm',
			platform: 'neutral',
			target: ['es2024'],
			packages: 'external',
			sourcemap: 'external',
			sourcesContent: false,
			minify: doMinify,
			treeShaking: true,
			banner,
			loader: {
				'.ttf': 'file',
				'.svg': 'file',
				'.png': 'file',
				'.sh': 'file',
			},
			assetNames: 'media/[name]',
			plugins,
			write: false, // Don't write yet, we need to post-process
			logLevel: 'warning',
			logOverride: {
				'unsupported-require-call': 'silent',
			},
			tsconfigRaw,
		});

		buildResults.push({ outPath, result });
	}));

	// Bundle bootstrap files (with minimist inlined) directly from TypeScript source
	for (const entry of bootstrapEntryPoints) {
		const entryPath = path.join(REPO_ROOT, SRC_DIR, `${entry}.ts`);
		if (!fs.existsSync(entryPath)) {
			console.log(`[bundle] Skipping ${entry} (not found)`);
			continue;
		}

		const outPath = path.join(REPO_ROOT, OUT_VSCODE_DIR, `${entry}.js`);

		const bootstrapPlugins: esbuild.Plugin[] = [inlineMinimistPlugin()];
		if (doNls) {
			bootstrapPlugins.unshift(nlsPlugin({
				baseDir: path.join(REPO_ROOT, SRC_DIR),
				collector: nlsCollector,
			}));
		}

		const result = await esbuild.build({
			entryPoints: [entryPath],
			outfile: outPath,
			bundle: true,
			format: 'esm',
			platform: 'node',
			target: ['es2024'],
			packages: 'external',
			sourcemap: 'external',
			sourcesContent: false,
			minify: doMinify,
			treeShaking: true,
			banner,
			plugins: bootstrapPlugins,
			write: false, // Don't write yet, we need to post-process
			logLevel: 'warning',
			logOverride: {
				'unsupported-require-call': 'silent',
			},
			tsconfigRaw,
		});

		buildResults.push({ outPath, result });
	}

	// Finalize NLS: sort entries, assign indices, write metadata files
	let indexMap = new Map<string, number>();
	if (doNls) {
		const nlsResult = await finalizeNLS(nlsCollector, path.join(REPO_ROOT, OUT_VSCODE_DIR));
		indexMap = nlsResult.indexMap;
	}

	// Post-process and write all output files
	let bundled = 0;
	for (const { result } of buildResults) {
		if (!result.outputFiles) {
			continue;
		}

		for (const file of result.outputFiles) {
			await fs.promises.mkdir(path.dirname(file.path), { recursive: true });

			if (doNls && file.path.endsWith('.js') && indexMap.size > 0) {
				// Post-process JS files to replace NLS placeholders with indices
				const processed = postProcessNLS(file.text, indexMap, preserveEnglish);
				await fs.promises.writeFile(file.path, processed);
			} else {
				// Write other files (source maps, etc.) as-is
				await fs.promises.writeFile(file.path, file.contents);
			}
		}
		bundled++;
	}

	// Copy resources (exclude dev files and tests for production)
	await copyResources(OUT_VSCODE_DIR, true, true);

	console.log(`[bundle] Done in ${Date.now() - t1}ms (${bundled} bundles)`);
}

// ============================================================================
// Watch Mode
// ============================================================================

async function watch(): Promise<void> {
	console.log('[watch] Starting...');

	const outDir = OUT_DIR;

	// Initial setup
	await cleanDir(outDir);
	console.log(`[transpile] ${SRC_DIR} → ${outDir}`);

	// Initial full build
	const t1 = Date.now();
	try {
		await transpile(outDir, false);
		await copyResources(outDir, false, false);
		console.log(`[transpile] Done in ${Date.now() - t1}ms`);
	} catch (err) {
		console.error('[watch] Initial build failed:', err);
		// Continue watching anyway
	}

	let pendingTsFiles: Set<string> = new Set();
	let pendingCopyFiles: Set<string> = new Set();

	const processChanges = async () => {
		const t1 = Date.now();
		const tsFiles = [...pendingTsFiles];
		const filesToCopy = [...pendingCopyFiles];
		pendingTsFiles = new Set();
		pendingCopyFiles = new Set();

		try {
			// Transform changed TypeScript files in parallel
			if (tsFiles.length > 0) {
				console.log(`[watch] Transpiling ${tsFiles.length} file(s)...`);
				await Promise.all(tsFiles.map(srcPath => {
					const relativePath = path.relative(path.join(REPO_ROOT, SRC_DIR), srcPath);
					const destPath = path.join(REPO_ROOT, outDir, relativePath.replace(/\.ts$/, '.js'));
					return transpileFile(srcPath, destPath, relativePath);
				}));
			}

			// Copy changed resource files in parallel
			if (filesToCopy.length > 0) {
				await Promise.all(filesToCopy.map(async (srcPath) => {
					const relativePath = path.relative(path.join(REPO_ROOT, SRC_DIR), srcPath);
					const destPath = path.join(REPO_ROOT, outDir, relativePath);
					await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
					await fs.promises.copyFile(srcPath, destPath);
					console.log(`[watch] Copied ${relativePath}`);
				}));
			}

			if (tsFiles.length > 0 || filesToCopy.length > 0) {
				console.log(`[watch] Done in ${Date.now() - t1}ms`);
			}
		} catch (err) {
			console.error('[watch] Rebuild failed:', err);
			// Continue watching
		}
	};

	// Extensions to watch and copy (non-TypeScript resources)
	const copyExtensions = ['.css', '.html', '.js', '.json', '.ttf', '.svg', '.png', '.mp3', '.scm', '.sh', '.ps1', '.psm1', '.fish', '.zsh', '.scpt'];

	// Watch src directory
	const subscription = await watcher.subscribe(
		path.join(REPO_ROOT, SRC_DIR),
		(err, events) => {
			if (err) {
				console.error('[watch] Watcher error:', err);
				return;
			}

			for (const event of events) {
				if (event.path.includes('/test/')) {
					continue;
				}

				if (event.path.endsWith('.ts') && !event.path.endsWith('.d.ts')) {
					pendingTsFiles.add(event.path);
				} else if (copyExtensions.some(ext => event.path.endsWith(ext))) {
					pendingCopyFiles.add(event.path);
				}
			}

			if (pendingTsFiles.size > 0 || pendingCopyFiles.size > 0) {
				processChanges();
			}
		},
		{ ignore: ['**/test/**', '**/node_modules/**'] }
	);

	console.log('[watch] Watching src/**/*.{ts,css,...} (Ctrl+C to stop)');

	// Keep process alive
	process.on('SIGINT', async () => {
		console.log('\n[watch] Stopping...');
		await subscription.unsubscribe();
		process.exit(0);
	});
}

// ============================================================================
// Main
// ============================================================================

function printUsage(): void {
	console.log(`Usage: npx tsx build/esbuild/index.ts <command> [options]

Commands:
	transpile          Transpile TypeScript to JavaScript (single-file, fast)
	bundle             Bundle entry points into optimized bundles

Options for 'transpile':
	--watch            Watch for changes and rebuild incrementally

Options for 'bundle':
	--minify           Minify the output bundles
	--nls              Process NLS (localization) strings

Examples:
	npx tsx build/esbuild/index.ts transpile
	npx tsx build/esbuild/index.ts transpile --watch
	npx tsx build/esbuild/index.ts bundle
	npx tsx build/esbuild/index.ts bundle --minify --nls
`);
}

async function main(): Promise<void> {
	const t1 = Date.now();

	try {
		switch (command) {
			case 'transpile':
				if (options.watch) {
					await watch();
				} else {
					const outDir = OUT_DIR;
					await cleanDir(outDir);
					console.log(`[transpile] ${SRC_DIR} → ${outDir}`);
					const t1 = Date.now();
					await transpile(outDir, false);
					await copyResources(outDir, false, false);
					console.log(`[transpile] Done in ${Date.now() - t1}ms`);
				}
				break;

			case 'bundle':
				await bundle(options.minify, options.nls);
				break;

			default:
				printUsage();
				process.exit(command ? 1 : 0);
		}

		if (!options.watch) {
			console.log(`\n✓ Total: ${Date.now() - t1}ms`);
		}
	} catch (err) {
		console.error('Build failed:', err);
		process.exit(1);
	}
}

main();
