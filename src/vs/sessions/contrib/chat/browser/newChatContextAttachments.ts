/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { Emitter } from '../../../../base/common/event.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { isObject } from '../../../../base/common/types.js';
import { localize } from '../../../../nls.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem, IQuickPickItemWithResource } from '../../../../platform/quickinput/common/quickInput.js';
import { AnythingQuickAccessProviderRunOptions } from '../../../../platform/quickinput/common/quickAccess.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';

import { AnythingQuickAccessProvider } from '../../../../workbench/contrib/search/browser/anythingQuickAccess.js';
import { IChatRequestVariableEntry, OmittedState } from '../../../../workbench/contrib/chat/common/attachments/chatVariableEntries.js';
import { isSupportedChatFileScheme } from '../../../../workbench/contrib/chat/common/constants.js';
import { resizeImage } from '../../../../workbench/contrib/chat/browser/chatImageUtils.js';
import { imageToHash, isImage } from '../../../../workbench/contrib/chat/browser/widget/input/editor/chatPasteProviders.js';

/**
 * Manages context attachments for the sessions new-chat widget.
 *
 * Supports:
 * - File picker via quick access ("Files and Open Folders...")
 * - Image from Clipboard
 * - Drag and drop files
 */
export class NewChatContextAttachments extends Disposable {

	private readonly _attachedContext: IChatRequestVariableEntry[] = [];
	private _container: HTMLElement | undefined;

	private readonly _onDidChangeContext = this._register(new Emitter<void>());
	readonly onDidChangeContext = this._onDidChangeContext.event;

	get attachments(): readonly IChatRequestVariableEntry[] {
		return this._attachedContext;
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IFileService private readonly fileService: IFileService,
		@IClipboardService private readonly clipboardService: IClipboardService,
	) {
		super();
	}

	// --- Rendering ---

	renderAttachedContext(container: HTMLElement): void {
		this._container = container;
		this._updateRendering();
	}

	private _updateRendering(): void {
		if (!this._container) {
			return;
		}

		dom.clearNode(this._container);

		if (this._attachedContext.length === 0) {
			this._container.style.display = 'none';
			return;
		}

		this._container.style.display = '';

		for (const entry of this._attachedContext) {
			const pill = dom.append(this._container, dom.$('.sessions-chat-attachment-pill'));
			const icon = entry.kind === 'image' ? Codicon.fileMedia : Codicon.file;
			dom.append(pill, renderIcon(icon));
			dom.append(pill, dom.$('span.sessions-chat-attachment-name', undefined, entry.name));

			const removeButton = dom.append(pill, dom.$('.sessions-chat-attachment-remove'));
			removeButton.title = localize('removeAttachment', "Remove");
			removeButton.tabIndex = 0;
			removeButton.role = 'button';
			dom.append(removeButton, renderIcon(Codicon.close));
			this._register(dom.addDisposableListener(removeButton, dom.EventType.CLICK, (e) => {
				e.stopPropagation();
				this._removeAttachment(entry.id);
			}));
		}
	}

	// --- Drag and drop ---

	registerDropTarget(element: HTMLElement): void {
		this._register(dom.addDisposableListener(element, dom.EventType.DRAG_OVER, (e) => {
			e.preventDefault();
			e.dataTransfer!.dropEffect = 'copy';
			element.classList.add('sessions-chat-drop-active');
		}));

		this._register(dom.addDisposableListener(element, dom.EventType.DRAG_LEAVE, () => {
			element.classList.remove('sessions-chat-drop-active');
		}));

		this._register(dom.addDisposableListener(element, dom.EventType.DROP, async (e) => {
			e.preventDefault();
			element.classList.remove('sessions-chat-drop-active');

			const files = e.dataTransfer?.files;
			if (!files || files.length === 0) {
				return;
			}

			for (const file of Array.from(files)) {
				const filePath = (file as unknown as { path?: string }).path;
				if (!filePath) {
					continue;
				}
				const uri = URI.file(filePath);
				if (/\.(png|jpg|jpeg|bmp|gif|tiff)$/i.test(file.name)) {
					const readFile = await this.fileService.readFile(uri);
					const resizedImage = await resizeImage(readFile.value.buffer);
					this._addAttachments({
						id: uri.toString(),
						name: file.name,
						fullName: file.name,
						value: resizedImage,
						kind: 'image',
						references: [{ reference: uri, kind: 'reference' }]
					});
				} else {
					let omittedState = OmittedState.NotOmitted;
					try {
						const ref = await this.textModelService.createModelReference(uri);
						ref.dispose();
					} catch {
						omittedState = OmittedState.Full;
					}

					this._addAttachments({
						kind: 'file',
						id: uri.toString(),
						value: uri,
						name: file.name,
						omittedState,
					});
				}
			}
		}));
	}

	// --- Picker ---

	showPicker(): void {
		// Build addition picks for the quick access
		const additionPicks: IQuickPickItem[] = [];

		// "Image from Clipboard" pick
		additionPicks.push({
			label: localize('imageFromClipboard', "Image from Clipboard"),
			iconClass: ThemeIcon.asClassName(Codicon.fileMedia),
			id: 'sessions.imageFromClipboard',
		});

		const providerOptions: AnythingQuickAccessProviderRunOptions = {
			filter: (pick) => {
				if (_isQuickPickItemWithResource(pick) && pick.resource) {
					return this.instantiationService.invokeFunction(accessor => isSupportedChatFileScheme(accessor, pick.resource!.scheme));
				}
				return true;
			},
			additionPicks,
			handleAccept: async (item: IQuickPickItem) => {
				if (item.id === 'sessions.imageFromClipboard') {
					await this._handleClipboardImage();
				} else {
					await this._handleFilePick(item as IQuickPickItemWithResource);
				}
			}
		};

		this.quickInputService.quickAccess.show('', {
			enabledProviderPrefixes: [AnythingQuickAccessProvider.PREFIX],
			placeholder: localize('chatContext.attach.placeholder', "Search files to attach"),
			providerOptions,
		});
	}

	private async _handleFilePick(pick: IQuickPickItemWithResource): Promise<void> {
		if (!pick.resource) {
			return;
		}

		if (/\.(png|jpg|jpeg|bmp|gif|tiff)$/i.test(pick.resource.path)) {
			const readFile = await this.fileService.readFile(pick.resource);
			const resizedImage = await resizeImage(readFile.value.buffer);
			this._addAttachments({
				id: pick.resource.toString(),
				name: pick.label,
				fullName: pick.label,
				value: resizedImage,
				kind: 'image',
				references: [{ reference: pick.resource, kind: 'reference' }]
			});
		} else {
			let omittedState = OmittedState.NotOmitted;
			try {
				const ref = await this.textModelService.createModelReference(pick.resource);
				ref.dispose();
			} catch {
				omittedState = OmittedState.Full;
			}

			this._addAttachments({
				kind: 'file',
				id: pick.resource.toString(),
				value: pick.resource,
				name: pick.label,
				omittedState,
			});
		}
	}

	private async _handleClipboardImage(): Promise<void> {
		const imageData = await this.clipboardService.readImage();
		if (!isImage(imageData)) {
			return;
		}

		this._addAttachments({
			id: await imageToHash(imageData),
			name: localize('pastedImage', "Pasted Image"),
			fullName: localize('pastedImage', "Pasted Image"),
			value: imageData,
			kind: 'image',
		});
	}

	// --- State management ---

	private _addAttachments(...entries: IChatRequestVariableEntry[]): void {
		for (const entry of entries) {
			if (!this._attachedContext.some(e => e.id === entry.id)) {
				this._attachedContext.push(entry);
			}
		}
		this._updateRendering();
		this._onDidChangeContext.fire();
	}

	private _removeAttachment(id: string): void {
		const index = this._attachedContext.findIndex(e => e.id === id);
		if (index >= 0) {
			this._attachedContext.splice(index, 1);
			this._updateRendering();
			this._onDidChangeContext.fire();
		}
	}

	clear(): void {
		this._attachedContext.length = 0;
		this._updateRendering();
		this._onDidChangeContext.fire();
	}
}

function _isQuickPickItemWithResource(obj: unknown): obj is IQuickPickItemWithResource {
	return (
		isObject(obj)
		&& URI.isUri((obj as IQuickPickItemWithResource).resource));
}
