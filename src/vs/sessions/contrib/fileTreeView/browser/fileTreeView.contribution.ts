/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { SessionRepoFileSystemProvider, SESSION_REPO_SCHEME } from './sessionRepoFileSystemProvider.js';

// --- View registration is currently disabled in favor of the "Add Context" picker.
// The Files view will be re-enabled once we finalize the sessions auxiliary bar layout.

// --- Session Repo FileSystem Provider Registration

class SessionRepoFileSystemProviderContribution extends Disposable {

	static readonly ID = 'workbench.contrib.sessionRepoFileSystemProvider';

	constructor(
		@IFileService fileService: IFileService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		const provider = this._register(instantiationService.createInstance(SessionRepoFileSystemProvider));
		this._register(fileService.registerProvider(SESSION_REPO_SCHEME, provider));
	}
}

registerWorkbenchContribution2(
	SessionRepoFileSystemProviderContribution.ID,
	SessionRepoFileSystemProviderContribution,
	WorkbenchPhase.AfterRestored
);
