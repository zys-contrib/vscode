/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from '../../../../../platform/quickinput/common/quickInput.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { dirname } from '../../../../../base/common/resources.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { IAgentPlugin, IAgentPluginService } from '../../common/plugins/agentPluginService.js';
import { IMarketplacePlugin, IPluginMarketplaceService } from '../../common/plugins/pluginMarketplaceService.js';
import { CHAT_CATEGORY, CHAT_CONFIG_MENU_ID } from './chatActions.js';
import { ResourceSet } from '../../../../../base/common/map.js';

const enum ManagePluginItemKind {
	Plugin = 'plugin',
	FindMore = 'findMore',
}

interface IPluginPickItem extends IQuickPickItem {
	readonly kind: ManagePluginItemKind.Plugin;
	plugin: IAgentPlugin;
}

interface IFindMorePickItem extends IQuickPickItem {
	readonly kind: ManagePluginItemKind.FindMore;
}

interface IMarketplacePluginPickItem extends IQuickPickItem {
	marketplacePlugin: IMarketplacePlugin;
}

class ManagePluginsAction extends Action2 {
	static readonly ID = 'workbench.action.chat.managePlugins';

	constructor() {
		super({
			id: ManagePluginsAction.ID,
			title: localize2('managePlugins', 'Manage Plugins...'),
			category: CHAT_CATEGORY,
			precondition: ChatContextKeys.enabled,
			menu: [{
				id: CHAT_CONFIG_MENU_ID,
			}],
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const agentPluginService = accessor.get(IAgentPluginService);
		const quickInputService = accessor.get(IQuickInputService);
		const labelService = accessor.get(ILabelService);
		const dialogService = accessor.get(IDialogService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const pluginMarketplaceService = accessor.get(IPluginMarketplaceService);

		const allPlugins = agentPluginService.allPlugins.get();
		const disabledUris = agentPluginService.disabledPluginUris.get();
		const hasWorkspace = workspaceContextService.getWorkspace().folders.length > 0;

		if (allPlugins.length === 0 && !hasWorkspace) {
			dialogService.info(
				localize('noPlugins', 'No plugins found.'),
				localize('noPluginsDetail', 'There are currently no agent plugins discovered in this workspace.')
			);
			return;
		}

		// Group plugins by parent directory label
		const groups = new Map<string, IAgentPlugin[]>();
		for (const plugin of allPlugins) {
			const groupLabel = labelService.getUriLabel(dirname(plugin.uri), { relative: true });
			let group = groups.get(groupLabel);
			if (!group) {
				group = [];
				groups.set(groupLabel, group);
			}
			group.push(plugin);
		}

		const items: QuickPickInput<IPluginPickItem | IFindMorePickItem>[] = [];
		for (const [groupLabel, plugins] of groups) {
			items.push({ type: 'separator', label: groupLabel });
			for (const plugin of plugins) {
				const pluginName = plugin.uri.path.split('/').at(-1) ?? '';
				items.push({
					kind: ManagePluginItemKind.Plugin,
					label: pluginName,
					plugin,
					picked: !disabledUris.has(plugin.uri),
				} satisfies IPluginPickItem);
			}
		}

		if (hasWorkspace) {
			items.push({ type: 'separator' });
			items.push({
				kind: ManagePluginItemKind.FindMore,
				label: localize('findMorePlugins', 'Find More Plugins...'),
			} satisfies IFindMorePickItem);
		}

		const result = await quickInputService.pick(
			items,
			{
				canPickMany: true,
				title: localize('managePluginsTitle', 'Manage Plugins'),
				placeHolder: localize('managePluginsPlaceholder', 'Choose which plugins are enabled'),
			}
		);

		if (!result) {
			return;
		}

		// Check if "Find More Plugins..." was selected
		const findMoreSelected = result.some(item => item.kind === ManagePluginItemKind.FindMore);
		if (findMoreSelected) {
			await showMarketplaceQuickPick(quickInputService, pluginMarketplaceService, dialogService);
			return;
		}

		const pluginResults = result.filter((item): item is IPluginPickItem => item.kind === ManagePluginItemKind.Plugin);
		const enabledUris = new ResourceSet(pluginResults.map(i => i.plugin.uri));
		for (const plugin of allPlugins) {
			const wasDisabled = disabledUris.has(plugin.uri);
			const isNowEnabled = enabledUris.has(plugin.uri);

			if (wasDisabled && isNowEnabled) {
				agentPluginService.setPluginEnabled(plugin.uri, true);
			} else if (!wasDisabled && !isNowEnabled) {
				agentPluginService.setPluginEnabled(plugin.uri, false);
			}
		}
	}
}

async function showMarketplaceQuickPick(
	quickInputService: IQuickInputService,
	pluginMarketplaceService: IPluginMarketplaceService,
	dialogService: IDialogService,
): Promise<void> {
	const quickPick = quickInputService.createQuickPick<IMarketplacePluginPickItem>({ useSeparators: true });
	quickPick.title = localize('marketplaceTitle', 'Plugin Marketplace');
	quickPick.placeholder = localize('marketplacePlaceholder', 'Select a plugin to install');
	quickPick.busy = true;
	quickPick.show();

	const cts = new CancellationTokenSource();
	quickPick.onDidHide(() => cts.dispose(true));

	try {
		const plugins = await pluginMarketplaceService.fetchMarketplacePlugins(cts.token);

		if (cts.token.isCancellationRequested) {
			return;
		}

		if (plugins.length === 0) {
			quickPick.items = [];
			quickPick.busy = false;
			quickPick.placeholder = localize('noMarketplacePlugins', 'No plugins found in configured marketplaces');
			return;
		}

		// Group by marketplace
		const groups = new Map<string, IMarketplacePlugin[]>();
		for (const plugin of plugins) {
			let group = groups.get(plugin.marketplace);
			if (!group) {
				group = [];
				groups.set(plugin.marketplace, group);
			}
			group.push(plugin);
		}

		const items: QuickPickInput<IMarketplacePluginPickItem>[] = [];
		for (const [marketplace, marketplacePlugins] of groups) {
			items.push({ type: 'separator', label: marketplace });
			for (const plugin of marketplacePlugins) {
				items.push({
					label: plugin.name,
					detail: plugin.description,
					description: plugin.version,
					marketplacePlugin: plugin,
				});
			}
		}

		quickPick.items = items;
		quickPick.busy = false;
	} catch {
		quickPick.busy = false;
		quickPick.placeholder = localize('marketplaceError', 'Failed to fetch plugins from marketplaces');
		return;
	}

	const selection = await new Promise<IMarketplacePluginPickItem | undefined>(resolve => {
		quickPick.onDidAccept(() => {
			resolve(quickPick.selectedItems[0]);
			quickPick.hide();
		});
		quickPick.onDidHide(() => resolve(undefined));
	});

	if (selection) {
		// TODO: Implement plugin installation
		dialogService.info(
			localize('installNotSupported', 'Plugin Installation'),
			localize('installNotSupportedDetail', "Installing '{0}' from '{1}' is not yet supported.", selection.marketplacePlugin.name, selection.marketplacePlugin.marketplace)
		);
	}
}

export function registerChatPluginActions() {
	registerAction2(ManagePluginsAction);
}
