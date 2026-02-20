/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { parse as parseJSONC } from '../../../../../base/common/json.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ResourceSet } from '../../../../../base/common/map.js';
import { autorun, derived, IObservable, observableValue } from '../../../../../base/common/observable.js';
import {
	basename,
	extname, joinPath
} from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IMcpServerConfiguration, IMcpStdioServerConfiguration, McpServerType } from '../../../../../platform/mcp/common/mcpPlatformTypes.js';
import { ObservableMemento, observableMemento } from '../../../../../platform/observable/common/observableMemento.js';
import { observableConfigValue } from '../../../../../platform/observable/common/platformObservableUtils.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ChatConfiguration } from '../constants.js';
import { PromptFileParser } from '../promptSyntax/promptFileParser.js';
import { agentPluginDiscoveryRegistry, IAgentPlugin, IAgentPluginCommand, IAgentPluginDiscovery, IAgentPluginHook, IAgentPluginMcpServerDefinition, IAgentPluginService, IAgentPluginSkill } from './agentPluginService.js';

const STORAGE_KEY = 'workbench.chat.plugins.disabled';
const COMMAND_FILE_SUFFIX = '.md';

const disabledPluginUrisMemento = observableMemento<ReadonlySet<URI>>({
	key: STORAGE_KEY,
	defaultValue: new ResourceSet(),
	fromStorage: value => {
		try {
			const parsed = JSON.parse(value);
			if (!Array.isArray(parsed)) {
				return new ResourceSet();
			}

			const uris = parsed
				.filter((entry): entry is string => typeof entry === 'string')
				.map(entry => URI.parse(entry));

			return new ResourceSet(uris);
		} catch {
			return new ResourceSet();
		}
	},
	toStorage: value => JSON.stringify([...value].map(uri => uri.toString()).sort((a, b) => a.localeCompare(b)))
});

export class AgentPluginService extends Disposable implements IAgentPluginService {

	declare readonly _serviceBrand: undefined;

	public readonly allPlugins: IObservable<readonly IAgentPlugin[]>;
	private readonly _disabledPluginUrisMemento: ObservableMemento<ReadonlySet<URI>>;

	public readonly disabledPluginUris: IObservable<ReadonlySet<URI>>;
	public readonly plugins: IObservable<readonly IAgentPlugin[]>;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
	) {
		super();
		this._disabledPluginUrisMemento = this._register(disabledPluginUrisMemento(StorageScope.PROFILE, StorageTarget.MACHINE, storageService));

		this.disabledPluginUris = this._disabledPluginUrisMemento;

		const discoveries: IAgentPluginDiscovery[] = [];
		for (const descriptor of agentPluginDiscoveryRegistry.getAll()) {
			const discovery = instantiationService.createInstance(descriptor);
			this._register(discovery);
			discoveries.push(discovery);
			discovery.start();
		}


		this.allPlugins = derived(read => this._dedupeAndSort(discoveries.flatMap(d => d.plugins.read(read))));

		this.plugins = derived(reader => {
			const all = this.allPlugins.read(reader);
			const disabled = this.disabledPluginUris.read(reader);
			if (disabled.size === 0) {
				return all;
			}

			return all.filter(p => !disabled.has(p.uri));
		});
	}

	public setPluginEnabled(pluginUri: URI, enabled: boolean): void {
		const current = new ResourceSet([...this._disabledPluginUrisMemento.get()]);
		if (enabled) {
			current.delete(pluginUri);
		} else {
			current.add(pluginUri);
		}
		this._disabledPluginUrisMemento.set(current, undefined);
	}

	private _dedupeAndSort(plugins: readonly IAgentPlugin[]): readonly IAgentPlugin[] {
		const unique: IAgentPlugin[] = [];
		const seen = new ResourceSet();

		for (const plugin of plugins) {
			if (seen.has(plugin.uri)) {
				continue;
			}

			seen.add(plugin.uri);
			unique.push(plugin);
		}

		unique.sort((a, b) => a.uri.toString().localeCompare(b.uri.toString()));
		return unique;
	}
}

export class ConfiguredAgentPluginDiscovery extends Disposable implements IAgentPluginDiscovery {

	private readonly _pluginPaths: IObservable<readonly string[]>;
	private readonly _pluginEntries = new Map<string, { plugin: IAgentPlugin; store: DisposableStore }>();

	private readonly _plugins = observableValue<readonly IAgentPlugin[]>('discoveredAgentPlugins', []);
	public readonly plugins: IObservable<readonly IAgentPlugin[]> = this._plugins;

	private _discoverVersion = 0;

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();
		this._pluginPaths = observableConfigValue(ChatConfiguration.PluginPaths, [], configurationService);
	}

	public start(): void {
		const scheduler = this._register(new RunOnceScheduler(() => this._refreshPlugins(), 0));
		this._register(autorun(reader => {
			this._pluginPaths.read(reader);
			scheduler.schedule();
		}));
		scheduler.schedule();
	}

	private async _refreshPlugins(): Promise<void> {
		const version = ++this._discoverVersion;
		const plugins = await this._discoverPlugins();
		if (version !== this._discoverVersion || this._store.isDisposed) {
			return;
		}

		this._plugins.set(plugins, undefined);
	}

	private async _discoverPlugins(): Promise<readonly IAgentPlugin[]> {
		const plugins: IAgentPlugin[] = [];
		const seenPluginUris = new Set<string>();

		for (const path of this._pluginPaths.get()) {
			if (typeof path !== 'string' || !path.trim()) {
				continue;
			}

			const resource = URI.file(path);
			let stat;
			try {
				stat = await this._fileService.resolve(resource);
			} catch {
				continue;
			}

			if (!stat.isDirectory) {
				continue;
			}

			const key = stat.resource.toString();
			if (!seenPluginUris.has(key)) {
				seenPluginUris.add(key);
				plugins.push(this._toPlugin(stat.resource));
			}
		}

		this._disposePluginEntriesExcept(seenPluginUris);

		plugins.sort((a, b) => a.uri.toString().localeCompare(b.uri.toString()));
		return plugins;
	}

	private _toPlugin(uri: URI): IAgentPlugin {
		const key = uri.toString();
		const existing = this._pluginEntries.get(key);
		if (existing) {
			return existing.plugin;
		}

		const store = this._register(new DisposableStore());
		const commands = observableValue<readonly IAgentPluginCommand[]>('agentPluginCommands', []);
		const skills = observableValue<readonly IAgentPluginSkill[]>('agentPluginSkills', []);
		const mcpServerDefinitions = observableValue<readonly IAgentPluginMcpServerDefinition[]>('agentPluginMcpServerDefinitions', []);
		const plugin: IAgentPlugin = {
			uri,
			hooks: observableValue<readonly IAgentPluginHook[]>('agentPluginHooks', []),
			commands,
			skills,
			mcpServerDefinitions,
		};

		const commandsDir = joinPath(uri, 'commands');
		const skillsDir = joinPath(uri, 'skills');

		const commandsScheduler = store.add(new RunOnceScheduler(async () => {
			commands.set(await this._readCommands(uri), undefined);
		}, 200));
		const skillsScheduler = store.add(new RunOnceScheduler(async () => {
			skills.set(await this._readSkills(uri), undefined);
		}, 200));
		const mcpScheduler = store.add(new RunOnceScheduler(async () => {
			mcpServerDefinitions.set(await this._readMcpDefinitions(uri), undefined);
		}, 200));

		store.add(this._fileService.watch(uri, { recursive: true, excludes: [] }));
		store.add(this._fileService.onDidFilesChange(e => {
			if (e.affects(commandsDir)) {
				commandsScheduler.schedule();
			}
			if (e.affects(skillsDir)) {
				skillsScheduler.schedule();
			}
			// MCP definitions come from .mcp.json, plugin.json, or .claude-plugin/plugin.json
			if (e.affects(joinPath(uri, '.mcp.json')) || e.affects(joinPath(uri, 'plugin.json')) || e.affects(joinPath(uri, '.claude-plugin'))) {
				mcpScheduler.schedule();
			}
		}));

		commandsScheduler.schedule();
		skillsScheduler.schedule();
		mcpScheduler.schedule();

		this._pluginEntries.set(key, { plugin, store });
		return plugin;
	}

	private async _readMcpDefinitions(pluginUri: URI): Promise<readonly IAgentPluginMcpServerDefinition[]> {
		const mcpUri = joinPath(pluginUri, '.mcp.json');

		const mcpFileConfig = await this._readJsonFile(mcpUri);
		const fileDefinitions = this._parseMcpServerDefinitionMap(mcpFileConfig);

		const pluginJsonDefinitions = await this._readInlinePluginJsonMcpDefinitions(pluginUri);

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

	private async _readInlinePluginJsonMcpDefinitions(pluginUri: URI): Promise<readonly IAgentPluginMcpServerDefinition[]> {
		const manifestPaths = [
			joinPath(pluginUri, 'plugin.json'),
			joinPath(pluginUri, '.claude-plugin', 'plugin.json'),
		];

		for (const manifestPath of manifestPaths) {
			const manifest = await this._readJsonFile(manifestPath);
			if (!manifest || typeof manifest !== 'object') {
				continue;
			}

			const manifestRecord = manifest as Record<string, unknown>;
			const mcpServers = manifestRecord['mcpServers'];
			const definitions = this._parseMcpServerDefinitionMap(mcpServers);
			if (definitions.length > 0) {
				return definitions;
			}
		}

		return [];
	}

	private _parseMcpServerDefinitionMap(raw: unknown): IAgentPluginMcpServerDefinition[] {
		if (!raw || typeof raw !== 'object') {
			return [];
		}

		const definitions: IAgentPluginMcpServerDefinition[] = [];
		for (const [name, configValue] of Object.entries(raw as Record<string, unknown>)) {
			const configuration = this._normalizeMcpServerConfiguration(configValue);
			if (!configuration) {
				continue;
			}

			definitions.push({ name, configuration });
		}

		return definitions;
	}

	private _normalizeMcpServerConfiguration(rawConfig: unknown): IMcpServerConfiguration | undefined {
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

	private async _readJsonFile(uri: URI): Promise<unknown | undefined> {
		try {
			const fileContents = await this._fileService.readFile(uri);
			return parseJSONC(fileContents.value.toString());
		} catch {
			return undefined;
		}
	}

	private async _readSkills(uri: URI): Promise<readonly IAgentPluginSkill[]> {
		const skillsDir = joinPath(uri, 'skills');
		let stat;
		try {
			stat = await this._fileService.resolve(skillsDir);
		} catch {
			return [];
		}

		if (!stat.isDirectory || !stat.children) {
			return [];
		}

		const parser = new PromptFileParser();
		const skills: IAgentPluginSkill[] = [];
		for (const child of stat.children) {
			if (!child.isFile || extname(child.resource).toLowerCase() !== COMMAND_FILE_SUFFIX) {
				continue;
			}

			let fileContents;
			try {
				fileContents = await this._fileService.readFile(child.resource);
			} catch {
				continue;
			}

			const parsed = parser.parse(child.resource, fileContents.value.toString());
			const name = parsed.header?.name?.trim() || basename(child.resource).slice(0, -COMMAND_FILE_SUFFIX.length);

			skills.push({
				uri: child.resource,
				name,
				description: parsed.header?.description,
				content: parsed.body?.getContent()?.trim() ?? '',
			});
		}

		skills.sort((a, b) => a.name.localeCompare(b.name));
		return skills;
	}

	private async _readCommands(uri: URI): Promise<readonly IAgentPluginCommand[]> {
		const commandsDir = joinPath(uri, 'commands');
		let stat;
		try {
			stat = await this._fileService.resolve(commandsDir);
		} catch {
			return [];
		}

		if (!stat.isDirectory || !stat.children) {
			return [];
		}

		const parser = new PromptFileParser();
		const commands: IAgentPluginCommand[] = [];
		for (const child of stat.children) {
			if (!child.isFile || extname(child.resource).toLowerCase() !== COMMAND_FILE_SUFFIX) {
				continue;
			}

			let fileContents;
			try {
				fileContents = await this._fileService.readFile(child.resource);
			} catch {
				continue;
			}

			const parsed = parser.parse(child.resource, fileContents.value.toString());
			const name = parsed.header?.name?.trim() || basename(child.resource).slice(0, -COMMAND_FILE_SUFFIX.length);

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

