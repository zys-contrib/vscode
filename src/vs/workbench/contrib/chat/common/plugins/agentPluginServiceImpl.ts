/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { parse as parseJSONC } from '../../../../../base/common/json.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { autorun, IObservable, observableValue } from '../../../../../base/common/observable.js';
import { extname, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IMcpServerConfiguration, IMcpStdioServerConfiguration, McpServerType } from '../../../../../platform/mcp/common/mcpPlatformTypes.js';
import { observableConfigValue } from '../../../../../platform/observable/common/platformObservableUtils.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ChatConfiguration } from '../constants.js';
import { PromptFileParser } from '../promptSyntax/promptFileParser.js';
import { agentPluginDiscoveryRegistry, IAgentPlugin, IAgentPluginCommand, IAgentPluginDiscovery, IAgentPluginHook, IAgentPluginMcpServerDefinition, IAgentPluginService } from './agentPluginService.js';

export class AgentPluginService extends Disposable implements IAgentPluginService {

	declare readonly _serviceBrand: undefined;

	private readonly _plugins = observableValue<readonly IAgentPlugin[]>('agentPlugins', []);
	public readonly plugins: IObservable<readonly IAgentPlugin[]> = this._plugins;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		const store = this._register(new DisposableStore());

		this._register(autorun(reader => {
			store.clear();

			const discoveries: IAgentPluginDiscovery[] = [];
			for (const descriptor of agentPluginDiscoveryRegistry.getAll()) {
				const discovery = instantiationService.createInstance(descriptor);
				store.add(discovery);
				discoveries.push(discovery);
				discovery.start();
			}

			store.add(autorun(innerReader => {
				const discoveredPlugins: IAgentPlugin[] = [];
				for (const discovery of discoveries) {
					discoveredPlugins.push(...discovery.plugins.read(innerReader));
				}

				this._plugins.set(this._dedupeAndSort(discoveredPlugins), undefined);
			}));
		}));
	}

	private _dedupeAndSort(plugins: readonly IAgentPlugin[]): readonly IAgentPlugin[] {
		const unique: IAgentPlugin[] = [];
		const seen = new Set<string>();

		for (const plugin of plugins) {
			const key = plugin.uri.toString();
			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			unique.push(plugin);
		}

		unique.sort((a, b) => a.uri.toString().localeCompare(b.uri.toString()));
		return unique;
	}
}

abstract class WorkspaceAgentPluginDiscovery extends Disposable implements IAgentPluginDiscovery {

	private readonly _enabled: IObservable<boolean>;
	private readonly _manualPluginPaths: IObservable<readonly string[]>;
	protected abstract readonly pluginSearchPaths: readonly string[];
	private readonly _pluginEntries = new Map<string, { plugin: IAgentPlugin; store: DisposableStore }>();

	private readonly _plugins = observableValue<readonly IAgentPlugin[]>('discoveredAgentPlugins', []);
	public readonly plugins: IObservable<readonly IAgentPlugin[]> = this._plugins;

	private _discoverVersion = 0;

	constructor(
		enabledConfigKey: ChatConfiguration,
		enabledDefault: boolean,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IFileService protected readonly fileService: IFileService,
	) {
		super();
		this._enabled = observableConfigValue(enabledConfigKey, enabledDefault, configurationService);
		this._manualPluginPaths = observableConfigValue(ChatConfiguration.PluginPaths, [], configurationService);
	}

	public start(): void {
		const scheduler = this._register(new RunOnceScheduler(() => this._refreshPlugins(), 0));
		this._register(autorun(reader => {
			this._enabled.read(reader);
			this._manualPluginPaths.read(reader);
			scheduler.schedule();
		}));
		this._register(this._workspaceContextService.onDidChangeWorkspaceFolders(() => scheduler.schedule()));
		scheduler.schedule();
	}

	private async _refreshPlugins(): Promise<void> {
		const version = ++this._discoverVersion;
		const plugins = await this.discoverPlugins();
		if (version !== this._discoverVersion || this._store.isDisposed) {
			return;
		}

		this._plugins.set(plugins, undefined);
	}

	protected async discoverPlugins(): Promise<readonly IAgentPlugin[]> {
		if (this._enabled.get() === false) {
			this._disposePluginEntriesExcept(new Set<string>());
			return [];
		}

		const candidates = await this.findCandidatePluginDirectories();
		const plugins: IAgentPlugin[] = [];
		const seenPluginUris = new Set<string>();

		for (const uri of candidates) {
			if (!(await this.isPluginRoot(uri))) {
				continue;
			}

			const key = uri.toString();
			seenPluginUris.add(key);
			plugins.push(this.toPlugin(uri));
		}

		this._disposePluginEntriesExcept(seenPluginUris);

		plugins.sort((a, b) => a.uri.toString().localeCompare(b.uri.toString()));
		return plugins;
	}

	protected toPlugin(uri: URI): IAgentPlugin {
		const key = uri.toString();
		const existing = this._pluginEntries.get(key);
		if (existing) {
			return existing.plugin;
		}

		const store = this._register(new DisposableStore());
		const commands = observableValue<readonly IAgentPluginCommand[]>('agentPluginCommands', []);
		const mcpServerDefinitions = observableValue<readonly IAgentPluginMcpServerDefinition[]>('agentPluginMcpServerDefinitions', []);
		const plugin: IAgentPlugin = {
			uri,
			hooks: observableValue<readonly IAgentPluginHook[]>('agentPluginHooks', []),
			commands,
			mcpServerDefinitions,
		};

		const scheduler = store.add(new RunOnceScheduler(() => {
			void (async () => {
				const [nextCommands, nextMcpDefinitions] = await Promise.all([
					this.readCommands(uri),
					this.readMcpDefinitions(uri),
				]);
				if (!store.isDisposed) {
					commands.set(nextCommands, undefined);
					mcpServerDefinitions.set(nextMcpDefinitions, undefined);
				}
			})();
		}, 200));

		store.add(this.fileService.watch(uri, { recursive: true, excludes: [] }));
		store.add(this.fileService.onDidFilesChange(e => {
			if (e.affects(uri)) {
				scheduler.schedule();
			}
		}));
		scheduler.schedule();

		this._pluginEntries.set(key, { plugin, store });
		return plugin;
	}

	private async readMcpDefinitions(pluginUri: URI): Promise<readonly IAgentPluginMcpServerDefinition[]> {
		const mcpUri = joinPath(pluginUri, '.mcp.json');

		const mcpFileConfig = await this.readJsonFile(mcpUri);
		const fileDefinitions = this.parseMcpServerDefinitionMap(mcpFileConfig);

		const pluginJsonDefinitions = await this.readInlinePluginJsonMcpDefinitions(pluginUri);

		const merged = new Map<string, IMcpServerConfiguration>();
		for (const definition of fileDefinitions) {
			merged.set(definition.name, definition.configuration);
		}
		for (const definition of pluginJsonDefinitions) {
			if (!merged.has(definition.name)) {
				merged.set(definition.name, definition.configuration);
			}
		}

		const definitions = [...merged.entries()]
			.map(([name, configuration]) => ({ name, configuration } satisfies IAgentPluginMcpServerDefinition))
			.sort((a, b) => a.name.localeCompare(b.name));

		return definitions;
	}

	private async readInlinePluginJsonMcpDefinitions(pluginUri: URI): Promise<readonly IAgentPluginMcpServerDefinition[]> {
		const manifestPaths = [
			joinPath(pluginUri, 'plugin.json'),
			joinPath(pluginUri, '.claude-plugin', 'plugin.json'),
		];

		for (const manifestPath of manifestPaths) {
			const manifest = await this.readJsonFile(manifestPath);
			if (!manifest || typeof manifest !== 'object') {
				continue;
			}

			const manifestRecord = manifest as Record<string, unknown>;
			const mcpServers = manifestRecord['mcpServers'];
			const definitions = this.parseMcpServerDefinitionMap(mcpServers);
			if (definitions.length > 0) {
				return definitions;
			}
		}

		return [];
	}

	private parseMcpServerDefinitionMap(raw: unknown): IAgentPluginMcpServerDefinition[] {
		if (!raw || typeof raw !== 'object') {
			return [];
		}

		const definitions: IAgentPluginMcpServerDefinition[] = [];
		for (const [name, configValue] of Object.entries(raw as Record<string, unknown>)) {
			const configuration = this.normalizeMcpServerConfiguration(configValue);
			if (!configuration) {
				continue;
			}

			definitions.push({ name, configuration });
		}

		return definitions;
	}

	private normalizeMcpServerConfiguration(rawConfig: unknown): IMcpServerConfiguration | undefined {
		if (!rawConfig || typeof rawConfig !== 'object') {
			return undefined;
		}

		const candidate = rawConfig as Record<string, unknown>;
		const type = typeof candidate['type'] === 'string' ? candidate['type'] : undefined;

		const command = typeof candidate['command'] === 'string' ? candidate['command'] : undefined;
		const url = typeof candidate['url'] === 'string' ? candidate['url'] : undefined;
		const args = Array.isArray(candidate['args']) ? candidate['args'].filter((value): value is string => typeof value === 'string') : undefined;
		const env = candidate['env'] && typeof candidate['env'] === 'object'
			? Object.fromEntries(Object.entries(candidate['env'] as Record<string, unknown>)
				.filter(([, value]) => typeof value === 'string' || typeof value === 'number' || value === null)
				.map(([key, value]) => [key, value as string | number | null]))
			: undefined;
		const envFile = typeof candidate['envFile'] === 'string' ? candidate['envFile'] : undefined;
		const cwd = typeof candidate['cwd'] === 'string' ? candidate['cwd'] : undefined;
		const headers = candidate['headers'] && typeof candidate['headers'] === 'object'
			? Object.fromEntries(Object.entries(candidate['headers'] as Record<string, unknown>)
				.filter(([, value]) => typeof value === 'string')
				.map(([key, value]) => [key, value as string]))
			: undefined;
		const dev = candidate['dev'] && typeof candidate['dev'] === 'object' ? candidate['dev'] as IMcpStdioServerConfiguration['dev'] : undefined;

		if (type === 'ws') {
			return undefined;
		}

		if (type === McpServerType.LOCAL || (!type && command)) {
			if (!command) {
				return undefined;
			}

			return {
				type: McpServerType.LOCAL,
				command,
				args,
				env,
				envFile,
				cwd,
				dev,
			};
		}

		if (type === McpServerType.REMOTE || type === 'sse' || (!type && url)) {
			if (!url) {
				return undefined;
			}

			return {
				type: McpServerType.REMOTE,
				url,
				headers,
				dev,
			};
		}

		return undefined;
	}

	private async readJsonFile(uri: URI): Promise<unknown | undefined> {
		try {
			const fileContents = await this.fileService.readFile(uri);
			return parseJSONC(fileContents.value.toString());
		} catch {
			return undefined;
		}
	}

	private async readCommands(uri: URI): Promise<readonly IAgentPluginCommand[]> {
		const commandsDir = joinPath(uri, 'commands');
		let stat;
		try {
			stat = await this.fileService.resolve(commandsDir);
		} catch {
			return [];
		}

		if (!stat.isDirectory || !stat.children) {
			return [];
		}

		const parser = new PromptFileParser();
		const commands: IAgentPluginCommand[] = [];
		for (const child of stat.children) {
			if (!child.isFile || extname(child.resource) !== '.md') {
				continue;
			}

			let fileContents;
			try {
				fileContents = await this.fileService.readFile(child.resource);
			} catch {
				continue;
			}

			const parsed = parser.parse(child.resource, fileContents.value.toString());
			const name = parsed.header?.name?.trim();
			if (!name) {
				continue;
			}

			commands.push({
				uri: child.resource,
				name,
				description: parsed.header?.description,
				content: parsed.body?.getContent()?.trim() ?? '',
			});
		}

		commands.sort((a, b) => a.name.localeCompare(b.name));
		return commands;
	}

	protected abstract isPluginRoot(uri: URI): Promise<boolean>;

	private async findCandidatePluginDirectories(): Promise<readonly URI[]> {
		const pluginDirectories = new Map<string, URI>();
		for (const folder of this._workspaceContextService.getWorkspace().folders) {
			for (const searchPath of this.pluginSearchPaths) {
				const pluginRoot = joinPath(folder.uri, searchPath);
				let stat;
				try {
					stat = await this.fileService.resolve(pluginRoot);
				} catch {
					continue;
				}

				if (!stat.isDirectory || !stat.children) {
					continue;
				}

				const children = stat.children.slice().sort((a, b) => a.name.localeCompare(b.name));
				for (const child of children) {
					if (child.isDirectory) {
						pluginDirectories.set(child.resource.toString(), child.resource);
					}
				}
			}
		}

		for (const path of this._manualPluginPaths.get()) {
			if (typeof path !== 'string' || !path.trim()) {
				continue;
			}

			const resource = URI.file(path);
			let stat;
			try {
				stat = await this.fileService.resolve(resource);
			} catch {
				continue;
			}

			if (stat.isDirectory) {
				pluginDirectories.set(stat.resource.toString(), stat.resource);
			}
		}

		return [...pluginDirectories.values()];
	}

	private _disposePluginEntriesExcept(keep: Set<string>): void {
		for (const [key, entry] of this._pluginEntries) {
			if (!keep.has(key)) {
				entry.store.dispose();
				this._pluginEntries.delete(key);
			}
		}
	}

	public override dispose(): void {
		this._disposePluginEntriesExcept(new Set<string>());
		super.dispose();
	}
}

export class CopilotAgentPluginDiscovery extends WorkspaceAgentPluginDiscovery {
	protected readonly pluginSearchPaths = ['.copilot/plugins', '.vscode/plugins'];

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@IFileService fileService: IFileService,
	) {
		super(ChatConfiguration.CopilotPluginsEnabled, true, configurationService, workspaceContextService, fileService);
	}

	protected isPluginRoot(uri: URI): Promise<boolean> {
		return this.fileService.exists(joinPath(uri, 'plugin.json'));
	}
}

export class ClaudeAgentPluginDiscovery extends WorkspaceAgentPluginDiscovery {
	protected readonly pluginSearchPaths = ['.claude/plugins', '.vscode/plugins'];

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@IFileService fileService: IFileService,
	) {
		super(ChatConfiguration.ClaudePluginsEnabled, false, configurationService, workspaceContextService, fileService);
	}

	protected async isPluginRoot(uri: URI): Promise<boolean> {
		const checks = await Promise.all([
			this.fileService.exists(joinPath(uri, '.claude-plugin/plugin.json')),
			this.fileService.exists(joinPath(uri, 'agents')),
			this.fileService.exists(joinPath(uri, 'skills')),
			this.fileService.exists(joinPath(uri, 'commands')),
			this.fileService.exists(joinPath(uri, 'hooks.json')),
			this.fileService.exists(joinPath(uri, '.mcp.json')),
			this.fileService.exists(joinPath(uri, '.lsp.json')),
		]);

		return checks.some(Boolean);
	}
}

