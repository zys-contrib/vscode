/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/openInAgents.css';
import { $, addDisposableListener, append, EventHelper, EventType } from '../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { StandardKeyboardEvent } from '../../../base/browser/keyboardEvent.js';
import { BaseActionViewItem, IBaseActionViewItemOptions } from '../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction } from '../../../base/common/actions.js';
import { KeyCode } from '../../../base/common/keyCodes.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IActionViewItemService } from '../../../platform/actions/browser/actionViewItemService.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { IInstantiationService, ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../platform/native/common/native.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../platform/workspace/common/workspace.js';
import { ToggleTitleBarConfigAction, TitleBarLeadingActionsGroup } from '../../browser/parts/titlebar/titlebarActions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IsAuxiliaryWindowContext, IsSessionsWindowContext } from '../../common/contextkeys.js';
import { workbenchConfigurationNodeBase } from '../../common/configuration.js';
import { IWorkbenchEnvironmentService } from '../../services/environment/common/environmentService.js';

const OpenInAgentsActionId = 'workbench.action.openInAgents';
const OpenInAgentsEnabledSetting = 'workbench.openInAgents.enabled';

type OpenInAgentsMode = 'siblingApp' | 'newWindow';

type OpenInAgentsEvent = { mode: OpenInAgentsMode };
type OpenInAgentsClassification = {
	owner: 'osortega';
	comment: 'Tracks when the user opens the Agents application from the VS Code titlebar.';
	mode: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'How the Agents app was opened: siblingApp (launched separate Agents app) or newWindow (in-process agents window).' };
};

const OpenInAgentsVisibility = ContextKeyExpr.and(
	ContextKeyExpr.equals(`config.${OpenInAgentsEnabledSetting}`, true),
	IsSessionsWindowContext.toNegated(),
	IsAuxiliaryWindowContext.toNegated(),
);

/**
 * Action that opens the Agents application for the current workspace.
 *
 * In built builds where a sibling Agents app is registered (`darwinSiblingBundleIdentifier`
 * / `win32SiblingExeBasename`), launches it via {@link INativeHostService.launchSiblingApp}
 * with `--agents` and the current workspace folder/file. Otherwise falls back to opening
 * a new in-process Agents window via {@link INativeHostService.openAgentsWindow}.
 */
class OpenInAgentsAction extends Action2 {

	constructor() {
		super({
			id: OpenInAgentsActionId,
			title: localize2('openInAgents', 'Open in Agents'),
			f1: true,
			precondition: OpenInAgentsVisibility,
			menu: [{
				// Render in the global titlebar tool bar in the dedicated leading
				// slot so we appear before the layout controls (and stay visible
				// when layout controls are toggled off).
				id: MenuId.TitleBar,
				group: TitleBarLeadingActionsGroup,
				order: -1000,
				when: OpenInAgentsVisibility,
			}, {
				// Also surface inside the "Customize Layout..." submenu so users
				// can toggle the entry on/off from the layout customization UI.
				id: MenuId.LayoutControlMenuSubmenu,
				group: '0_workbench_layout',
				order: -1000,
				when: OpenInAgentsVisibility,
			}]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const nativeHostService = accessor.get(INativeHostService);
		const productService = accessor.get(IProductService);
		const environmentService = accessor.get(IWorkbenchEnvironmentService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const telemetryService = accessor.get(ITelemetryService);

		const args: string[] = ['--new-window'];

		const workspace = workspaceContextService.getWorkspace();
		switch (workspaceContextService.getWorkbenchState()) {
			case WorkbenchState.FOLDER:
				if (workspace.folders.length > 0) {
					args.push('--folder-uri', workspace.folders[0].uri.toString());
				}
				break;
			case WorkbenchState.WORKSPACE:
				if (workspace.configuration) {
					args.push('--file-uri', workspace.configuration.toString());
				}
				break;
		}

		const hasSibling = !!(
			productService.darwinSiblingBundleIdentifier ||
			productService.win32SiblingExeBasename
		);

		// In built builds with a sibling Agents app available, launch it.
		// Otherwise (dev / OSS / no sibling), open a new agents window of
		// the current Electron app.
		const mode: OpenInAgentsMode = environmentService.isBuilt && hasSibling ? 'siblingApp' : 'newWindow';
		telemetryService.publicLog2<OpenInAgentsEvent, OpenInAgentsClassification>('vscode.openInAgents', { mode });

		if (mode === 'siblingApp') {
			await nativeHostService.launchSiblingApp(args);
		} else {
			await nativeHostService.openAgentsWindow({ forceNewWindow: true });
		}
	}
}

/**
 * Renders the "Open in Agents" titlebar entry as an icon-only button that
 * expands to reveal a label on hover / keyboard focus.
 */
class OpenInAgentsTitleBarWidget extends BaseActionViewItem {

	constructor(
		action: IAction,
		options: IBaseActionViewItemOptions | undefined,
		@IProductService private readonly productService: IProductService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super(undefined, action, options);
	}

	override render(container: HTMLElement): void {
		super.render(container);

		container.classList.add('open-in-agents-titlebar-widget');
		container.setAttribute('role', 'button');
		container.setAttribute('data-product-quality', this.productService.quality ?? 'stable');

		const label = this.action.label || localize('openInAgents', 'Open in Agents');
		container.setAttribute('aria-label', label);
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), container, label));

		const icon = append(container, $('span.open-in-agents-titlebar-widget-icon'));
		icon.setAttribute('aria-hidden', 'true');

		const labelEl = append(container, $('span.open-in-agents-titlebar-widget-label'));
		labelEl.textContent = label;

		// BaseActionViewItem only wires mouse / touch — add Enter / Space activation
		// so the widget is usable via keyboard.
		this._register(addDisposableListener(container, EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				EventHelper.stop(event, true);
				this.onClick(e);
			}
		}));
	}
}

class OpenInAgentsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openInAgents.desktop';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(actionViewItemService.register(MenuId.TitleBar, OpenInAgentsActionId, (action, options) => {
			return instantiationService.createInstance(OpenInAgentsTitleBarWidget, action, options);
		}, undefined));
	}
}

registerAction2(OpenInAgentsAction);
registerWorkbenchContribution2(OpenInAgentsContribution.ID, OpenInAgentsContribution, WorkbenchPhase.BlockRestore);

// Toggle entry in titlebar context menu (right-click on titlebar)
registerAction2(class ToggleOpenInAgents extends ToggleTitleBarConfigAction {
	constructor() {
		super(
			OpenInAgentsEnabledSetting,
			localize('toggle.openInAgents', 'Open in Agents'),
			localize('toggle.openInAgentsDescription', "Toggle visibility of the Open in Agents button in title bar"),
			6,
		);
	}
});

// Configuration setting backing the toggle.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	...workbenchConfigurationNodeBase,
	properties: {
		[OpenInAgentsEnabledSetting]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize('openInAgentsEnabled', "Controls whether the Open in Agents button is shown in the title bar."),
		}
	}
});
