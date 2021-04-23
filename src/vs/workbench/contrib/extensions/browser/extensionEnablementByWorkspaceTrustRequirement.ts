/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IWorkbenchExtensionEnablementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';


export class ExtensionEnablementByWorkspaceTrustRequirement extends Disposable implements IWorkbenchContribution {

	constructor(
		@IExtensionService private readonly extensionService: IExtensionService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.workspaceTrustManagementService.onBeforeChangeTrust(e => {
			if (!e.trusted) {
				return;
			}

			return e.join(new Promise(resolve => {
				// Untrusted -> Trusted
				// Enable extensions before notifying listeners
				this.extensionEnablementService.updateEnablementByWorkspaceTrustRequirement().then(() => resolve());
			}));
		}));

		this._register(this.workspaceTrustManagementService.onDidChangeTrust(async trusted => {
			if (!trusted) {
				// Trusted -> Untrusted
				// Restart extension host
				this.extensionService.stopExtensionHosts();
				await this.extensionEnablementService.updateEnablementByWorkspaceTrustRequirement();
				this.extensionService.startExtensionHosts();
			}
		}));
	}
}
