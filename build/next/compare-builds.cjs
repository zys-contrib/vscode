/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const fs = require('fs');
const path = require('path');

function walk(dir, base) {
	let results = [];
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const e of entries) {
			const rel = path.join(base, e.name);
			if (e.isDirectory()) {
				results = results.concat(walk(path.join(dir, e.name), rel));
			} else {
				results.push(rel);
			}
		}
	} catch (err) { /* skip */ }
	return results;
}

const oldRoot = '/Users/jrieken/Code/vscode/Visual Studio Code - Insiders-OLD.app/Contents/Resources/app';
const newRoot = '/Users/jrieken/Code/vscode/Visual Studio Code - Insiders-NEW.app/Contents/Resources/app';

const oldFiles = new Set(walk(oldRoot, ''));
const newFiles = new Set(walk(newRoot, ''));

const onlyOld = [...oldFiles].filter(f => !newFiles.has(f)).sort();
const onlyNew = [...newFiles].filter(f => !oldFiles.has(f)).sort();

// Group by top-level directory
function groupByTopDir(files) {
	const groups = {};
	for (const f of files) {
		const parts = f.split(path.sep);
		const topDir = parts.length > 1 ? parts[0] : '(root)';
		if (!groups[topDir]) { groups[topDir] = []; }
		groups[topDir].push(f);
	}
	return groups;
}

console.log('OLD total files:', oldFiles.size);
console.log('NEW total files:', newFiles.size);
console.log('');

console.log('============================================');
console.log('FILES ONLY IN OLD (missing from NEW):', onlyOld.length);
console.log('============================================');
const oldGroups = groupByTopDir(onlyOld);
for (const [dir, files] of Object.entries(oldGroups).sort()) {
	console.log(`\n  [${dir}] (${files.length} files)`);
	for (const f of files.slice(0, 50)) {
		console.log(`    - ${f}`);
	}
	if (files.length > 50) { console.log(`    ... and ${files.length - 50} more`); }
}

console.log('');
console.log('============================================');
console.log('FILES ONLY IN NEW (extra in NEW):', onlyNew.length);
console.log('============================================');
const newGroups = groupByTopDir(onlyNew);
for (const [dir, files] of Object.entries(newGroups).sort()) {
	console.log(`\n  [${dir}] (${files.length} files)`);
	for (const f of files.slice(0, 50)) {
		console.log(`    - ${f}`);
	}
	if (files.length > 50) { console.log(`    ... and ${files.length - 50} more`); }
}

// Check JS files with significant size differences
console.log('');
console.log('============================================');
console.log('.js files with >2x size difference');
console.log('============================================');
const common = [...oldFiles].filter(f => newFiles.has(f) && f.endsWith('.js'));
const sizeDiffs = [];
for (const f of common) {
	try {
		const oldSize = fs.statSync(path.join(oldRoot, f)).size;
		const newSize = fs.statSync(path.join(newRoot, f)).size;
		if (oldSize === 0 || newSize === 0) { continue; }
		const ratio = newSize / oldSize;
		if (ratio < 0.5 || ratio > 2.0) {
			sizeDiffs.push({ file: f, oldSize, newSize, ratio });
		}
	} catch (e) { /* skip */ }
}
sizeDiffs.sort((a, b) => a.ratio - b.ratio);
if (sizeDiffs.length === 0) {
	console.log('  None found.');
} else {
	for (const d of sizeDiffs) {
		const arrow = d.ratio < 1 ? 'SMALLER' : 'LARGER';
		console.log(`  ${d.file}: OLD=${d.oldSize} NEW=${d.newSize} (${d.ratio.toFixed(2)}x, ${arrow})`);
	}
}

// Check for empty JS files in NEW that aren't empty in OLD
console.log('');
console.log('============================================');
console.log('.js files that became empty in NEW');
console.log('============================================');
let emptyCount = 0;
for (const f of common) {
	if (!f.endsWith('.js')) { continue; }
	try {
		const oldSize = fs.statSync(path.join(oldRoot, f)).size;
		const newSize = fs.statSync(path.join(newRoot, f)).size;
		if (oldSize > 0 && newSize === 0) {
			console.log(`  ${f}: was ${oldSize} bytes, now 0`);
			emptyCount++;
		}
	} catch (e) { /* skip */ }
}
if (emptyCount === 0) { console.log('  None found.'); }

// Size comparison by top-level directory within out/
console.log('');
console.log('============================================');
console.log('Size comparison by area (out/vs/*)');
console.log('============================================');

function dirSize(dir) {
	let total = 0;
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const e of entries) {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) {
				total += dirSize(full);
			} else {
				total += fs.statSync(full).size;
			}
		}
	} catch (e) { /* skip */ }
	return total;
}

const oldOut = path.join(oldRoot, 'out');
const newOut = path.join(newRoot, 'out');

// Top-level out/ size
const oldTotal = dirSize(oldOut);
const newTotal = dirSize(newOut);
console.log(`  TOTAL out/: OLD=${(oldTotal / 1024 / 1024).toFixed(1)}MB  NEW=${(newTotal / 1024 / 1024).toFixed(1)}MB  diff=+${((newTotal - oldTotal) / 1024 / 1024).toFixed(1)}MB`);

const areas = ['vs/base', 'vs/code', 'vs/editor', 'vs/platform', 'vs/workbench'];
for (const area of areas) {
	const oldSize = dirSize(path.join(oldOut, area));
	const newSize = dirSize(path.join(newOut, area));
	const diff = newSize - oldSize;
	const sign = diff >= 0 ? '+' : '';
	console.log(`  ${area}: OLD=${(oldSize / 1024 / 1024).toFixed(1)}MB  NEW=${(newSize / 1024 / 1024).toFixed(1)}MB  diff=${sign}${(diff / 1024 / 1024).toFixed(1)}MB`);
}

// Detailed breakdown of extra files in NEW
console.log('');
console.log('============================================');
console.log('EXTRA FILES IN NEW - DETAILED BREAKDOWN');
console.log('============================================');
const extra = [...newFiles].filter(f => !oldFiles.has(f)).sort();

const byExt = {};
for (const f of extra) {
	const ext = path.extname(f) || '(no ext)';
	if (!byExt[ext]) { byExt[ext] = []; }
	byExt[ext].push(f);
}
console.log('\nBy extension:');
for (const [ext, files] of Object.entries(byExt).sort((a, b) => b[1].length - a[1].length)) {
	console.log(`  ${ext}: ${files.length} files`);
}

// List all JS files
console.log('\n--- Extra .js files ---');
(byExt['.js'] || []).forEach(f => console.log(`  ${f}`));

// List all HTML files
console.log('\n--- Extra .html files ---');
(byExt['.html'] || []).forEach(f => console.log(`  ${f}`));

// List other non-CSS files
console.log('\n--- Extra non-CSS/non-JS/non-HTML files ---');
for (const f of extra) {
	const ext = path.extname(f);
	if (ext !== '.css' && ext !== '.js' && ext !== '.html') {
		console.log(`  ${f}`);
	}
}

// List CSS files grouped by area
console.log('\n--- Extra .css files by area ---');
const cssFiles = byExt['.css'] || [];
const cssAreas = {};
for (const f of cssFiles) {
	const parts = f.split(path.sep);
	const area = parts.length > 3 ? parts.slice(0, 3).join('/') : parts.slice(0, 2).join('/');
	if (!cssAreas[area]) { cssAreas[area] = []; }
	cssAreas[area].push(f);
}
for (const [area, files] of Object.entries(cssAreas).sort()) {
	console.log(`  [${area}] (${files.length} files)`);
}
