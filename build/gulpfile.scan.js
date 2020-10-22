/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const path = require('path');
const task = require('./lib/task');
const util = require('./lib/util');
const _ = require('underscore');
const electron = require('gulp-atom-electron');
const { config } = require('./lib/electron');

const root = path.dirname(__dirname);

const BUILD_TARGETS = [
	{ platform: 'win32', arch: 'ia32' },
	{ platform: 'win32', arch: 'x64' },
	{ platform: 'win32', arch: 'arm64' },
	{ platform: 'darwin', arch: null, opts: { stats: true } },
	{ platform: 'linux', arch: 'ia32' },
	{ platform: 'linux', arch: 'x64' },
	{ platform: 'linux', arch: 'armhf' },
	{ platform: 'linux', arch: 'arm64' },
];

BUILD_TARGETS.forEach(buildTarget => {
	const dashed = (str) => (str ? `-${str}` : ``);
	const platform = buildTarget.platform;
	const arch = buildTarget.arch;

	const destinationExe = path.join(path.dirname(root), 'scanbin', `VSCode${dashed(platform)}${dashed(arch)}`, 'bin');
	const destinationPdb = path.join(path.dirname(root), 'scanbin', `VSCode${dashed(platform)}${dashed(arch)}`, 'pdb');
	console.log(destinationExe);
	console.log(destinationPdb);

	const setupSymbolsTask = task.define(`vscode-symbols${dashed(platform)}${dashed(arch)}`,
		task.series(
			util.rimraf(destinationExe),
			util.rimraf(destinationPdb),
			() => electron.dest(destinationExe, _.extend({}, config, { platform, arch: arch === 'armhf' ? 'arm' : arch })),
			() => electron.dest(destinationPdb, _.extend({}, config, { platform, arch: arch === 'armhf' ? 'arm' : arch, pdbs: true }))
		)
	);

	gulp.task(setupSymbolsTask);
});

