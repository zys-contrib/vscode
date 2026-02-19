/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IViewContainersRegistry, ViewContainerLocation, IViewsRegistry, Extensions as ViewContainerExtensions, WindowVisibility } from '../../../../workbench/common/views.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { FILE_TREE_VIEW_CONTAINER_ID, FILE_TREE_VIEW_ID, FileTreeViewPane, FileTreeViewPaneContainer } from './fileTreeView.js';
import { SessionRepoFileSystemProvider, SESSION_REPO_SCHEME } from './sessionRepoFileSystemProvider.js';

// --- Icons

const fileTreeViewIcon = registerIcon('file-tree-view-icon', Codicon.repoClone, localize2('fileTreeViewIcon', 'View icon for the Files view.').value);

// --- View Container Registration

const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);

const fileTreeViewContainer = viewContainersRegistry.registerViewContainer({
	id: FILE_TREE_VIEW_CONTAINER_ID,
	title: localize2('files', 'Files'),
	ctorDescriptor: new SyncDescriptor(FileTreeViewPaneContainer),
	icon: fileTreeViewIcon,
	order: 20,
	hideIfEmpty: false,
	windowVisibility: WindowVisibility.Sessions
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true });

// --- View Registration

const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

viewsRegistry.registerViews([{
	id: FILE_TREE_VIEW_ID,
	name: localize2('files', 'Files'),
	containerIcon: fileTreeViewIcon,
	ctorDescriptor: new SyncDescriptor(FileTreeViewPane),
	canToggleVisibility: true,
	canMoveView: true,
	weight: 100,
	order: 2,
	windowVisibility: WindowVisibility.Sessions
}], fileTreeViewContainer);

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
	WorkbenchPhase.BlockStartup
);
