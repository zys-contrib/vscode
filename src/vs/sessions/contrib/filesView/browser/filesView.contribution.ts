/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IViewsRegistry, Extensions as ViewContainerExtensions, WindowVisibility } from '../../../../workbench/common/views.js';
import { CHANGES_VIEW_CONTAINER_ID } from '../../changesView/browser/changesView.js';
import { FILES_VIEW_ID, FILES_VIEW_TITLE, FilesViewPane } from './filesView.js';

const filesViewIcon = registerIcon('files-view-icon', Codicon.files, localize2('filesViewIcon', 'View icon for the Files view.').value);

const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

// Look up the already-registered changes view container
const viewContainersRegistry = Registry.as<import('../../../../workbench/common/views.js').IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const changesViewContainer = viewContainersRegistry.get(CHANGES_VIEW_CONTAINER_ID);

if (changesViewContainer) {
	viewsRegistry.registerViews([{
		id: FILES_VIEW_ID,
		name: FILES_VIEW_TITLE,
		containerIcon: filesViewIcon,
		ctorDescriptor: new SyncDescriptor(FilesViewPane),
		canToggleVisibility: true,
		canMoveView: true,
		weight: 80,
		order: 2,
		collapsed: true,
		windowVisibility: WindowVisibility.Sessions
	}], changesViewContainer);
}
