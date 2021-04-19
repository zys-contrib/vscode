/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from 'vs/base/browser/dom';
import { Emitter, Event } from 'vs/base/common/event';
import { ProxyChannel } from 'vs/base/parts/ipc/common/ipc';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFileService } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/services';
import { ILogService } from 'vs/platform/log/common/log';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { IRequestService } from 'vs/platform/request/common/request';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWebviewManagerService } from 'vs/platform/webview/common/webviewManagerService';
import { WebviewMessageChannels } from 'vs/workbench/contrib/webview/browser/baseWebviewElement';
import { WebviewThemeDataProvider } from 'vs/workbench/contrib/webview/browser/themeing';
import { WebviewContentOptions, WebviewExtensionDescription, WebviewOptions } from 'vs/workbench/contrib/webview/browser/webview';
import { IFrameWebview } from 'vs/workbench/contrib/webview/browser/webviewElement';
import { WebviewFindWidget } from 'vs/workbench/contrib/webview/browser/webviewFindWidget';
import { WindowIgnoreMenuShortcutsManager } from 'vs/workbench/contrib/webview/electron-sandbox/windowIgnoreMenuShortcutsManager';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

/**
 * Webview backed by an iframe but that uses Electron APIs to power the webview.
 */
export class ElectronIframeWebview extends IFrameWebview {

	private readonly _webviewKeyboardHandler: WindowIgnoreMenuShortcutsManager;

	private _webviewFindWidget: WebviewFindWidget | undefined;
	private _findStarted: boolean = false;

	private readonly _webviewMainService: IWebviewManagerService;

	constructor(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		extension: WebviewExtensionDescription | undefined,
		webviewThemeDataProvider: WebviewThemeDataProvider,
		@ITunnelService tunnelService: ITunnelService,
		@IFileService fileService: IFileService,
		@IRequestService requestService: IRequestService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IRemoteAuthorityResolverService _remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@ILogService logService: ILogService,
		@IConfigurationService configurationService: IConfigurationService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@INotificationService noficationService: INotificationService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(id, options, contentOptions, extension, webviewThemeDataProvider,
			configurationService, fileService, logService, noficationService, _remoteAuthorityResolverService, requestService, telemetryService, tunnelService, environmentService);

		this._webviewKeyboardHandler = new WindowIgnoreMenuShortcutsManager(configurationService, mainProcessService, nativeHostService);

		this._webviewMainService = ProxyChannel.toService<IWebviewManagerService>(mainProcessService.getChannel('webview'));

		this._register(this.on(WebviewMessageChannels.didFocus, () => {
			this._webviewKeyboardHandler.didFocus();
		}));

		this._register(this.on(WebviewMessageChannels.didBlur, () => {
			this._webviewKeyboardHandler.didBlur();
		}));

		if (options.enableFindWidget) {
			this._webviewFindWidget = this._register(instantiationService.createInstance(WebviewFindWidget, this));

			this._register(addDisposableListener(this.element!, 'found-in-page', e => {
				this._hasFindResult.fire(e.result.matches > 0);
			}));

			this.styledFindWidget();
		}
	}

	protected override initElement(extension: WebviewExtensionDescription | undefined, options: WebviewOptions) {
		super.initElement(extension, options, {
			platform: 'electron',
			'vscode-resource-origin': this.webviewResourceEndpoint,
		});
	}

	public mountTo(parent: HTMLElement) {
		if (!this.element) {
			return;
		}

		if (this._webviewFindWidget) {
			parent.appendChild(this._webviewFindWidget.getDomNode()!);
		}
		parent.appendChild(this.element);
	}

	protected override get webviewContentEndpoint(): string {
		const endpoint = this._environmentService.webviewExternalEndpoint!.replace('{{uuid}}', this.id);
		if (endpoint[endpoint.length - 1] === '/') {
			return endpoint.slice(0, endpoint.length - 1);
		}
		return endpoint;
	}

	protected override get webviewResourceEndpoint(): string {
		return `https://${this.id}.vscode-webview-test.com`;
	}

	protected override async doPostMessage(channel: string, data?: any): Promise<void> {
		this.element?.contentWindow!.postMessage({ channel, args: data }, '*');
	}

	protected override style(): void {
		super.style();
		this.styledFindWidget();
	}

	private styledFindWidget() {
		this._webviewFindWidget?.updateTheme(this.webviewThemeDataProvider.getTheme());
	}

	private readonly _hasFindResult = this._register(new Emitter<boolean>());
	public readonly hasFindResult: Event<boolean> = this._hasFindResult.event;

	public startFind(value: string) {
		if (!value || !this.element) {
			return;
		}

		// // ensure options is defined without modifying the original
		// options = options || {};

		// // FindNext must be false for a first request
		// const findOptions: FindInPageOptions = {
		// 	forward: options.forward,
		// 	findNext: true,
		// 	matchCase: options.matchCase
		// };

		this._findStarted = true;
		this._webviewMainService.findInFrame({ windowId: this.nativeHostService.windowId }, this.id, value, {});
	}

	/**
	 * Webviews expose a stateful find API.
	 * Successive calls to find will move forward or backward through onFindResults
	 * depending on the supplied options.
	 *
	 * @param value The string to search for. Empty strings are ignored.
	 */
	public find(value: string, previous: boolean): void {
		if (!this.element) {
			return;
		}

		// const options = { findNext: false, forward: !previous };
		if (!this._findStarted) {
			this.startFind(value);
		} else {
			this._webviewMainService.findInFrame({ windowId: this.nativeHostService.windowId }, this.id, value, {});
		}
	}

	public stopFind(keepSelection?: boolean): void {
		this._hasFindResult.fire(false);
		if (!this.element) {
			return;
		}
		this._findStarted = false;
		this._webviewMainService.stopFindInFrame({ windowId: this.nativeHostService.windowId }, this.id, {
			keepSelection
		});
	}

	public showFind() {
		this._webviewFindWidget?.reveal();
	}

	public hideFind() {
		this._webviewFindWidget?.hide();
	}

	public runFindAction(previous: boolean) {
		this._webviewFindWidget?.find(previous);
	}
}
