/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { basename } from '../../../../base/common/resources.js';
import { IObservable, observableValue } from '../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { agentHostUri } from '../../../../platform/agentHost/common/agentHostFileSystemProvider.js';
import { AGENT_HOST_SCHEME, agentHostAuthority, toAgentHostUri } from '../../../../platform/agentHost/common/agentHostUri.js';
import { type IAgentConnection, type IAgentSessionMetadata } from '../../../../platform/agentHost/common/agentService.js';
import { RemoteAgentHostConnectionStatus } from '../../../../platform/agentHost/common/remoteAgentHostService.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IChatWidgetService } from '../../../../workbench/contrib/chat/browser/chat.js';
import { IChatService } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { IChatSessionsService } from '../../../../workbench/contrib/chat/common/chatSessionsService.js';
import { ILanguageModelsService } from '../../../../workbench/contrib/chat/common/languageModels.js';
import { BaseAgentHostSessionsProvider } from '../../agentHost/browser/baseAgentHostSessionsProvider.js';
import { buildAgentHostSessionWorkspace } from '../../../common/agentHostSessionWorkspace.js';
import { ISession, ISessionType, ISessionWorkspace, ISessionWorkspaceBrowseAction } from '../../../services/sessions/common/session.js';
import { remoteAgentHostSessionTypeId } from '../common/remoteAgentHostSessionType.js';

function toLocalProjectUri(uri: URI, connectionAuthority: string): URI {
	return uri.scheme === Schemas.file ? toAgentHostUri(uri, connectionAuthority) : uri;
}

export interface IRemoteAgentHostSessionsProviderConfig {
	readonly address: string;
	readonly name: string;
	/** Optional hook to establish a connection on demand (e.g. tunnel relay). */
	readonly connectOnDemand?: () => Promise<void>;
}

/**
 * Sessions provider for a remote agent host connection. A thin subclass of
 * {@link BaseAgentHostSessionsProvider} that adds the connection-lifecycle
 * surface (`setConnection`/`clearConnection`), sticky authentication-pending
 * tracking, the well-known session-type mapping, and a remote folder picker.
 *
 * **URI/ID scheme:**
 * - **rawId** - unique session identifier (e.g. `abc123`), used as the cache key.
 * - **resource** - `{resourceScheme}:///{rawId}`. The scheme is the unique
 *   per-connection id and routes the chat service to the correct
 *   {@link AgentHostSessionHandler}.
 * - **sessionType** - the logical session type (e.g. `copilotcli` for copilot
 *   agents, or the per-connection id for other agents). Distinct from the
 *   resource scheme.
 * - **sessionId** - `{providerId}:{resource}` - the provider-scoped ID used by
 *   {@link ISessionsProvider} methods.
 * - Protocol operations (e.g. `disposeSession`) use the canonical agent
 *   session URI (`copilot:///abc123`), reconstructed via {@link AgentSession.uri}.
 */
export class RemoteAgentHostSessionsProvider extends BaseAgentHostSessionsProvider {

	readonly id: string;
	readonly label: string;
	readonly icon: ThemeIcon = Codicon.remote;
	readonly remoteAddress: string;
	readonly browseActions: readonly ISessionWorkspaceBrowseAction[];

	private _outputChannelId: string | undefined;
	get outputChannelId(): string | undefined { return this._outputChannelId; }

	private readonly _connectionStatus = observableValue<RemoteAgentHostConnectionStatus>('connectionStatus', RemoteAgentHostConnectionStatus.Disconnected);
	readonly connectionStatus: IObservable<RemoteAgentHostConnectionStatus> = this._connectionStatus;

	/**
	 * `true` while we are still resolving and pushing tokens for the host's
	 * `protectedResources`. Defaults to `true` so that sessions surface as
	 * loading until the first authentication pass settles.
	 */
	private readonly _authenticationPending = observableValue('authenticationPending', true);
	private _authenticationSettled = false;

	private readonly _onDidDisconnect = this._register(new Emitter<void>());
	protected override get onConnectionLost(): Event<void> { return this._onDidDisconnect.event; }

	private _connection: IAgentConnection | undefined;
	private _defaultDirectory: string | undefined;
	private readonly _connectionListeners = this._register(new DisposableStore());
	private readonly _connectionAuthority: string;
	private readonly _connectOnDemand: (() => Promise<void>) | undefined;

	constructor(
		config: IRemoteAgentHostSessionsProviderConfig,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IChatSessionsService chatSessionsService: IChatSessionsService,
		@IChatService chatService: IChatService,
		@IChatWidgetService chatWidgetService: IChatWidgetService,
		@ILanguageModelsService languageModelsService: ILanguageModelsService,
	) {
		super(chatSessionsService, chatService, chatWidgetService, languageModelsService);

		this._connectionAuthority = agentHostAuthority(config.address);
		this._connectOnDemand = config.connectOnDemand;
		const displayName = config.name || config.address;

		this.id = `agenthost-${this._connectionAuthority}`;
		this.label = displayName;
		this.remoteAddress = config.address;

		this.browseActions = [{
			label: localize('folders', "Folders"),
			icon: Codicon.remote,
			providerId: this.id,
			run: () => this._browseForFolder(),
		}];
	}

	// -- BaseAgentHostSessionsProvider hooks ---------------------------------

	protected get connection(): IAgentConnection | undefined { return this._connection; }

	protected get authenticationPending(): IObservable<boolean> { return this._authenticationPending; }

	protected _adapterOptions() {
		return {
			description: new MarkdownString().appendText(this.label),
			buildWorkspace: (project: IAgentSessionMetadata['project'], workingDirectory: URI | undefined) =>
				RemoteAgentHostSessionsProvider.buildWorkspace(project, workingDirectory, this.label),
		};
	}

	protected resourceSchemeForProvider(provider: string): string {
		return remoteAgentHostSessionTypeId(this._connectionAuthority, provider);
	}

	protected override mapWorkingDirectoryUri(uri: URI): URI {
		return toAgentHostUri(uri, this._connectionAuthority);
	}

	protected override mapProjectUri(uri: URI): URI {
		return toLocalProjectUri(uri, this._connectionAuthority);
	}

	protected override _diffUriMapper(): (uri: URI) => URI {
		return uri => toAgentHostUri(uri, this._connectionAuthority);
	}

	protected override _validateBeforeCreate(_sessionType: ISessionType): void {
		if (!this._connection) {
			throw new Error(localize('notConnectedSession', "Cannot create session: not connected to remote agent host '{0}'.", this.label));
		}
	}

	protected override _noAgentsErrorMessage(): string {
		return localize('noAgents', "Remote agent host '{0}' has not advertised any agents yet.", this.label);
	}

	protected override _notConnectedSendErrorMessage(): string {
		return localize('notConnectedSend', "Cannot send request: not connected to remote agent host '{0}'.", this.label);
	}

	// -- Connection lifecycle ------------------------------------------------

	/** Update the connection status for this provider. */
	setConnectionStatus(status: RemoteAgentHostConnectionStatus): void {
		this._connectionStatus.set(status, undefined);
	}

	/** Set the output channel ID for this provider's IPC log. */
	setOutputChannelId(id: string): void {
		this._outputChannelId = id;
	}

	setAuthenticationPending(pending: boolean): void {
		// Sticky: once the first authentication pass settles, never surface
		// pending again. Subsequent re-auths happen silently in the background.
		if (this._authenticationSettled) {
			return;
		}
		if (!pending) {
			this._authenticationSettled = true;
		}
		this._authenticationPending.set(pending, undefined);
	}

	/**
	 * Wire a live connection to this provider, enabling session operations and folder browsing.
	 */
	setConnection(connection: IAgentConnection, defaultDirectory?: string): void {
		if (this._connection === connection && this._defaultDirectory === defaultDirectory) {
			return;
		}

		this._connectionListeners.clear();
		this._sessionStateSubscriptions.clearAndDisposeAll();
		this._connection = connection;
		this._defaultDirectory = defaultDirectory;

		// Dynamically discover session types from the host's advertised agents.
		const rootStateValue = connection.rootState.value;
		if (rootStateValue && !(rootStateValue instanceof Error)) {
			this._syncSessionTypesFromRootState(rootStateValue);
		}
		this._connectionListeners.add(connection.rootState.onDidChange(rootState => {
			this._syncSessionTypesFromRootState(rootState);
		}));

		this._attachConnectionListeners(connection, this._connectionListeners);

		// Always refresh sessions when a connection is (re)established
		this._cacheInitialized = true;
		this._refreshSessions();
	}

	/**
	 * Clear the connection, e.g. when the remote host disconnects.
	 * Retains the provider registration so it remains visible in the UI.
	 */
	clearConnection(): void {
		this._connectionListeners.clear();
		this._sessionStateSubscriptions.clearAndDisposeAll();
		this._onDidDisconnect.fire();
		this._connection = undefined;
		this._defaultDirectory = undefined;
		if (this._currentNewSession) {
			this._clearNewSessionConfig(this._currentNewSession.sessionId);
			this._currentNewSession = undefined;
		}
		this._currentNewSessionStatus = undefined;
		this._currentNewSessionModelId = undefined;
		this._currentNewSessionLoading = undefined;
		this._selectedModelId = undefined;

		if (this._sessionTypes.length > 0) {
			this._sessionTypes = [];
			this._onDidChangeSessionTypes.fire();
		}

		const removed: ISession[] = Array.from(this._sessionCache.values());
		if (this._pendingSession) {
			removed.push(this._pendingSession);
			this._pendingSession = undefined;
		}
		this._sessionCache.clear();
		this._runningSessionConfigs.clear();
		this._cacheInitialized = false;
		if (removed.length > 0) {
			this._onDidChangeSessions.fire({ added: [], removed, changed: [] });
		}
	}

	// -- Session-type sync ---------------------------------------------------

	protected _formatSessionTypeLabel(agentLabel: string): string {
		return `${agentLabel} [${this.label}]`;
	}

	// -- Workspaces ----------------------------------------------------------

	static buildWorkspace(project: IAgentSessionMetadata['project'], workingDirectory: URI | undefined, providerLabel: string): ISessionWorkspace | undefined {
		return buildAgentHostSessionWorkspace(project, workingDirectory, { providerLabel, fallbackIcon: Codicon.remote, requiresWorkspaceTrust: false });
	}

	private _buildWorkspaceFromUri(uri: URI): ISessionWorkspace {
		const folderName = basename(uri) || uri.path;
		return {
			label: `${folderName} [${this.label}]`,
			icon: Codicon.remote,
			repositories: [{ uri, workingDirectory: undefined, detail: undefined, baseBranchName: undefined, baseBranchProtected: undefined }],
			requiresWorkspaceTrust: true,
		};
	}

	resolveWorkspace(repositoryUri: URI): ISessionWorkspace {
		return this._buildWorkspaceFromUri(repositoryUri);
	}

	// -- Browse --------------------------------------------------------------

	private async _browseForFolder(): Promise<ISessionWorkspace | undefined> {
		// Establish connection on demand if a hook is provided (e.g. tunnel relay)
		if (!this._connection && this._connectOnDemand) {
			await this._connectOnDemand();
		}

		if (!this._connection) {
			this._notificationService.error(localize('notConnected', "Unable to connect to remote agent host '{0}'.", this.label));
			return undefined;
		}

		const defaultUri = agentHostUri(this._connectionAuthority, this._defaultDirectory ?? '/');

		try {
			const selected = await this._fileDialogService.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				title: localize('selectRemoteFolder', "Select Folder on {0}", this.label),
				availableFileSystems: [AGENT_HOST_SCHEME],
				defaultUri,
			});
			if (selected?.[0]) {
				return this._buildWorkspaceFromUri(selected[0]);
			}
		} catch {
			// dialog was cancelled or failed
		}
		return undefined;
	}
}
