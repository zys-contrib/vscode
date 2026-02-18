/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/inlineChatOverlayWidget.css';
import * as dom from '../../../../base/browser/dom.js';
import { DEFAULT_FONT_FAMILY } from '../../../../base/browser/fonts.js';
import { renderAsPlaintext } from '../../../../base/browser/markdownRenderer.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { autorun, constObservable, derived, IObservable, observableFromEvent, observableFromEventOpts, observableValue } from '../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { IActiveCodeEditor, IOverlayWidgetPosition } from '../../../../editor/browser/editorBrowser.js';
import { ObservableCodeEditor } from '../../../../editor/browser/observableCodeEditor.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { EditorExtensionsRegistry } from '../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { localize } from '../../../../nls.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ChatEditingAcceptRejectActionViewItem } from '../../chat/browser/chatEditing/chatEditingEditorOverlay.js';
import { ACTION_START, CTX_INLINE_CHAT_INPUT_HAS_TEXT } from '../common/inlineChat.js';
import { StickyScrollController } from '../../../../editor/contrib/stickyScroll/browser/stickyScrollController.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { getSimpleEditorOptions } from '../../codeEditor/browser/simpleEditorOptions.js';
import { PlaceholderTextContribution } from '../../../../editor/contrib/placeholderText/browser/placeholderTextContribution.js';
import { IInlineChatSession2 } from './inlineChatSessionService.js';
import { CancelChatActionId } from '../../chat/browser/actions/chatExecuteActions.js';
import { assertType } from '../../../../base/common/types.js';

/**
 * Overlay widget that displays a vertical action bar menu.
 */
export class InlineChatInputWidget extends Disposable {

	private readonly _domNode: HTMLElement;
	private readonly _container: HTMLElement;
	private readonly _inputContainer: HTMLElement;
	private readonly _toolbarContainer: HTMLElement;
	private readonly _input: IActiveCodeEditor;
	private readonly _position = observableValue<IOverlayWidgetPosition | null>(this, null);
	readonly position: IObservable<IOverlayWidgetPosition | null> = this._position;


	private readonly _showStore = this._store.add(new DisposableStore());
	private readonly _stickyScrollHeight: IObservable<number>;
	private readonly _layoutData: IObservable<{ totalWidth: number; toolbarWidth: number; height: number }>;
	private _anchorLineNumber: number = 0;
	private _anchorLeft: number = 0;
	private _anchorAbove: boolean = false;


	constructor(
		private readonly _editorObs: ObservableCodeEditor,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ICommandService private readonly _commandService: ICommandService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super();

		// Create container
		this._domNode = dom.$('.inline-chat-gutter-menu');

		// Create inner container (background + focus border)
		this._container = dom.append(this._domNode, dom.$('.inline-chat-gutter-container'));

		// Create input editor container
		this._inputContainer = dom.append(this._container, dom.$('.input'));

		// Create toolbar container
		this._toolbarContainer = dom.append(this._container, dom.$('.toolbar'));

		// Create editor options
		const options = getSimpleEditorOptions(configurationService);
		options.wordWrap = 'off';
		options.wrappingStrategy = 'advanced';
		options.lineNumbers = 'off';
		options.glyphMargin = false;
		options.lineDecorationsWidth = 0;
		options.lineNumbersMinChars = 0;
		options.folding = false;
		options.minimap = { enabled: false };
		options.scrollbar = { vertical: 'auto', horizontal: 'hidden', alwaysConsumeMouseWheel: true, verticalSliderSize: 6 };
		options.renderLineHighlight = 'none';
		options.fontFamily = DEFAULT_FONT_FAMILY;
		options.fontSize = 12;
		options.lineHeight = 18;
		options.cursorWidth = 1;

		const codeEditorWidgetOptions: ICodeEditorWidgetOptions = {
			isSimpleWidget: true,
			contributions: EditorExtensionsRegistry.getSomeEditorContributions([
				PlaceholderTextContribution.ID,
			])
		};

		this._input = this._store.add(instantiationService.createInstance(CodeEditorWidget, this._inputContainer, options, codeEditorWidgetOptions)) as IActiveCodeEditor;

		const model = this._store.add(modelService.createModel('', null, URI.parse(`gutter-input:${Date.now()}`), true));
		this._input.setModel(model);

		// Create toolbar
		const toolbar = this._store.add(instantiationService.createInstance(MenuWorkbenchToolBar, this._toolbarContainer, MenuId.InlineChatInput, {
			telemetrySource: 'inlineChatInput.toolbar',
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			toolbarOptions: {
				primaryGroup: () => true,
			},
			menuOptions: { shouldForwardArgs: true },
		}));

		// Initialize sticky scroll height observable
		const stickyScrollController = StickyScrollController.get(this._editorObs.editor);
		this._stickyScrollHeight = stickyScrollController ? observableFromEvent(stickyScrollController.onDidChangeStickyScrollHeight, () => stickyScrollController.stickyScrollWidgetHeight) : constObservable(0);

		// Track toolbar width changes
		const toolbarWidth = observableValue<number>(this, 0);
		const resizeObserver = new dom.DisposableResizeObserver(() => {
			toolbarWidth.set(dom.getTotalWidth(toolbar.getElement()), undefined);
		});
		this._store.add(resizeObserver);
		this._store.add(resizeObserver.observe(toolbar.getElement()));

		// Compute min and max widget width based on editor content width
		const maxWidgetWidth = derived(r => {
			const layoutInfo = this._editorObs.layoutInfo.read(r);
			return Math.max(0, Math.round(layoutInfo.contentWidth * 0.70));
		});
		const minWidgetWidth = derived(r => {
			const layoutInfo = this._editorObs.layoutInfo.read(r);
			return Math.max(0, Math.round(layoutInfo.contentWidth * 0.33));
		});

		const contentWidth = observableFromEvent(this, this._input.onDidChangeModelContent, () => this._input.getContentWidth());
		const contentHeight = observableFromEvent(this, this._input.onDidContentSizeChange, () => this._input.getContentHeight());

		this._layoutData = derived(r => {

			const totalWidth = contentWidth.read(r) + toolbarWidth.read(r);
			const minWidth = minWidgetWidth.read(r);
			const maxWidth = maxWidgetWidth.read(r);
			const clampedWidth = this._input.getOption(EditorOption.wordWrap) === 'on'
				? maxWidth
				: Math.max(minWidth, Math.min(totalWidth, maxWidth));

			const lineHeight = this._input.getOption(EditorOption.lineHeight);
			const clampedHeight = Math.min(contentHeight.read(r), (3 * lineHeight));

			if (totalWidth > clampedWidth) {
				// enable word wrap
				this._input.updateOptions({ wordWrap: 'on', });
			}

			return {
				toolbarWidth: toolbarWidth.read(r),
				totalWidth: clampedWidth,
				height: clampedHeight
			};
		});

		// Update container width and editor layout when width changes
		this._store.add(autorun(r => {
			const { toolbarWidth, totalWidth, height } = this._layoutData.read(r);

			const inputWidth = totalWidth - toolbarWidth;
			this._container.style.width = `${totalWidth}px`;
			this._inputContainer.style.width = `${inputWidth}px`;
			this._input.layout({ width: inputWidth, height });
		}));

		// Toggle focus class on the container
		this._store.add(this._input.onDidFocusEditorText(() => this._container.classList.add('focused')));
		this._store.add(this._input.onDidBlurEditorText(() => this._container.classList.remove('focused')));

		// Update placeholder based on selection state
		this._store.add(autorun(r => {
			const selection = this._editorObs.cursorSelection.read(r);
			const hasSelection = selection && !selection.isEmpty();
			const placeholderText = hasSelection
				? localize('placeholderWithSelection', "Modify selected code")
				: localize('placeholderNoSelection', "Generate code");

			this._input.updateOptions({ placeholder: this._keybindingService.appendKeybinding(placeholderText, ACTION_START) });
		}));


		// Track input text for context key and adjust width based on content
		const inputHasText = CTX_INLINE_CHAT_INPUT_HAS_TEXT.bindTo(this._contextKeyService);
		this._store.add(this._input.onDidChangeModelContent(() => {
			inputHasText.set(this._input.getModel().getValue().trim().length > 0);
		}));
		this._store.add(toDisposable(() => inputHasText.reset()));

		// Handle Enter key to submit
		this._store.add(this._input.onKeyDown(e => {
			if (e.keyCode === KeyCode.Enter && !e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				this._commandService.executeCommand('inlineChat.submitInput');
			} else if (e.keyCode === KeyCode.Escape) {
				// Hide overlay if input is empty
				const value = this._input.getModel().getValue() ?? '';
				if (!value) {
					e.preventDefault();
					e.stopPropagation();
					this.hide();
				}
			}
		}));

		// Track focus - hide when focus leaves
		const focusTracker = this._store.add(dom.trackFocus(this._domNode));
		this._store.add(focusTracker.onDidBlur(() => this.hide()));
	}

	get value(): string {
		return this._input.getModel().getValue();
	}

	/**
	 * Show the widget at the specified line.
	 * @param lineNumber The line number to anchor the widget to
	 * @param left Left offset relative to editor
	 * @param anchorAbove Whether to anchor above the position (widget grows upward)
	 */
	show(lineNumber: number, left: number, anchorAbove: boolean): void {
		this._showStore.clear();

		// Clear input state
		this._input.updateOptions({ wordWrap: 'off' });
		this._input.getModel().setValue('');

		// Store anchor info for scroll updates
		this._anchorLineNumber = lineNumber;
		this._anchorLeft = left;
		this._anchorAbove = anchorAbove;

		// Set initial position
		this._updatePosition();

		// Create overlay widget via observable pattern
		this._showStore.add(this._editorObs.createOverlayWidget({
			domNode: this._domNode,
			position: this._position,
			minContentWidthInPx: constObservable(0),
			allowEditorOverflow: true,
		}));

		// If anchoring above, adjust position after render to account for widget height
		if (anchorAbove) {
			this._updatePosition();
		}

		// Update position on scroll, hide if anchor line is out of view (only when input is empty)
		this._showStore.add(this._editorObs.editor.onDidScrollChange(() => {
			const visibleRanges = this._editorObs.editor.getVisibleRanges();
			const isLineVisible = visibleRanges.some(range =>
				this._anchorLineNumber >= range.startLineNumber && this._anchorLineNumber <= range.endLineNumber
			);
			const hasContent = !!this._input.getModel().getValue();
			if (!isLineVisible && !hasContent) {
				this.hide();
			} else {
				this._updatePosition();
			}
		}));

		// Focus the input editor
		setTimeout(() => this._input.focus(), 0);
	}

	private _updatePosition(): void {
		const editor = this._editorObs.editor;
		const lineHeight = editor.getOption(EditorOption.lineHeight);
		const top = editor.getTopForLineNumber(this._anchorLineNumber) - editor.getScrollTop();
		let adjustedTop = top;

		if (this._anchorAbove) {
			const widgetHeight = this._domNode.offsetHeight;
			adjustedTop = top - widgetHeight;
		} else {
			adjustedTop = top + lineHeight;
		}

		// Clamp to viewport bounds when anchor line is out of view
		const stickyScrollHeight = this._stickyScrollHeight.get();
		const layoutInfo = editor.getLayoutInfo();
		const widgetHeight = this._domNode.offsetHeight;
		const minTop = stickyScrollHeight;
		const maxTop = layoutInfo.height - widgetHeight;

		const clampedTop = Math.max(minTop, Math.min(adjustedTop, maxTop));
		const isClamped = clampedTop !== adjustedTop;
		this._domNode.classList.toggle('clamped', isClamped);

		this._position.set({
			preference: { top: clampedTop, left: this._anchorLeft },
			stackOrdinal: 10000,
		}, undefined);
	}

	/**
	 * Hide the widget (removes from editor but does not dispose).
	 */
	hide(): void {
		// Focus editor if focus is still within the editor's DOM
		const editorDomNode = this._editorObs.editor.getDomNode();
		if (editorDomNode && dom.isAncestorOfActiveElement(editorDomNode)) {
			this._editorObs.editor.focus();
		}
		this._position.set(null, undefined);
		this._showStore.clear();
	}
}

/**
 * Overlay widget that displays progress messages during inline chat requests.
 */
export class InlineChatSessionOverlayWidget extends Disposable {

	private readonly _domNode: HTMLElement = document.createElement('div');
	private readonly _container: HTMLElement;
	private readonly _statusNode: HTMLElement;
	private readonly _icon: HTMLElement;
	private readonly _message: HTMLElement;
	private readonly _toolbarNode: HTMLElement;

	private readonly _showStore = this._store.add(new DisposableStore());
	private readonly _position = observableValue<IOverlayWidgetPosition | null>(this, null);
	private readonly _minContentWidthInPx = constObservable(0);

	private readonly _stickyScrollHeight: IObservable<number>;

	constructor(
		private readonly _editorObs: ObservableCodeEditor,
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
	) {
		super();

		this._domNode.classList.add('inline-chat-session-overlay-widget');

		this._container = document.createElement('div');
		this._domNode.appendChild(this._container);
		this._container.classList.add('inline-chat-session-overlay-container');

		// Create status node with icon and message
		this._statusNode = document.createElement('div');
		this._statusNode.classList.add('status');
		this._icon = dom.append(this._statusNode, dom.$('span'));
		this._message = dom.append(this._statusNode, dom.$('span.message'));
		this._container.appendChild(this._statusNode);

		// Create toolbar node
		this._toolbarNode = document.createElement('div');
		this._toolbarNode.classList.add('toolbar');

		// Initialize sticky scroll height observable
		const stickyScrollController = StickyScrollController.get(this._editorObs.editor);
		this._stickyScrollHeight = stickyScrollController ? observableFromEvent(stickyScrollController.onDidChangeStickyScrollHeight, () => stickyScrollController.stickyScrollWidgetHeight) : constObservable(0);
	}

	show(session: IInlineChatSession2): void {
		assertType(this._editorObs.editor.hasModel());
		this._showStore.clear();

		// Derived entry observable for this session
		const entry = derived(r => session.editingSession.readEntry(session.uri, r));

		// Set up status message and icon observable
		const requestMessage = derived(r => {
			const chatModel = session?.chatModel;
			if (!session || !chatModel) {
				return undefined;
			}

			const response = chatModel.lastRequestObs.read(r)?.response;
			if (!response) {
				return { message: localize('working', "Working..."), icon: ThemeIcon.modify(Codicon.loading, 'spin') };
			}

			if (response.isComplete) {
				// Check for errors first
				const result = response.result;
				if (result?.errorDetails) {
					return {
						message: localize('error', "Sorry, your request failed"),
						icon: Codicon.error
					};
				}

				const changes = entry.read(r)?.changesCount.read(r) ?? 0;
				return {
					message: changes === 0
						? localize('done', "Done")
						: changes === 1
							? localize('done1', "Done, 1 change")
							: localize('doneN', "Done, {0} changes", changes),
					icon: Codicon.check
				};
			}

			const lastPart = observableFromEventOpts({ equalsFn: () => false }, response.onDidChange, () => response.response.value)
				.read(r)
				.filter(part => part.kind === 'progressMessage' || part.kind === 'toolInvocation')
				.at(-1);

			if (lastPart?.kind === 'toolInvocation') {
				return { message: lastPart.invocationMessage, icon: ThemeIcon.modify(Codicon.loading, 'spin') };
			} else if (lastPart?.kind === 'progressMessage') {
				return { message: lastPart.content, icon: ThemeIcon.modify(Codicon.loading, 'spin') };
			} else {
				return { message: localize('working', "Working..."), icon: ThemeIcon.modify(Codicon.loading, 'spin') };
			}
		});

		this._showStore.add(autorun(r => {
			const value = requestMessage.read(r);
			if (value) {
				this._message.innerText = renderAsPlaintext(value.message);
				this._icon.className = '';
				this._icon.classList.add(...ThemeIcon.asClassNameArray(value.icon));
			} else {
				this._message.innerText = '';
				this._icon.className = '';
			}
		}));

		// Add toolbar
		this._container.appendChild(this._toolbarNode);
		this._showStore.add(toDisposable(() => this._toolbarNode.remove()));

		const that = this;

		this._showStore.add(this._instaService.createInstance(MenuWorkbenchToolBar, this._toolbarNode, MenuId.ChatEditorInlineExecute, {
			telemetrySource: 'inlineChatProgress.overlayToolbar',
			hiddenItemStrategy: HiddenItemStrategy.Ignore,
			toolbarOptions: {
				primaryGroup: () => true,
				useSeparatorsInPrimaryActions: true
			},
			menuOptions: { renderShortTitle: true },
			actionViewItemProvider: (action, options) => {
				const primaryActions = [CancelChatActionId, 'inlineChat2.keep'];
				const labeledActions = primaryActions.concat(['inlineChat2.undo']);

				if (!labeledActions.includes(action.id)) {
					return undefined; // use default action view item with label
				}

				return new ChatEditingAcceptRejectActionViewItem(action, options, entry, undefined, that._keybindingService, primaryActions);
			}
		}));

		// Position in top right of editor, below sticky scroll
		const lineHeight = this._editorObs.getOption(EditorOption.lineHeight);

		// Track widget width changes
		const widgetWidth = observableValue<number>(this, 0);
		const resizeObserver = new dom.DisposableResizeObserver(() => {
			widgetWidth.set(this._domNode.offsetWidth, undefined);
		});
		this._showStore.add(resizeObserver);
		this._showStore.add(resizeObserver.observe(this._domNode));

		this._showStore.add(autorun(r => {
			const layoutInfo = this._editorObs.layoutInfo.read(r);
			const stickyScrollHeight = this._stickyScrollHeight.read(r);
			const width = widgetWidth.read(r);
			const padding = Math.round(lineHeight.read(r) * 2 / 3);

			// Cap max-width to the editor viewport (content area)
			const maxWidth = layoutInfo.contentWidth - 2 * padding;
			this._domNode.style.maxWidth = `${maxWidth}px`;

			// Position: top right, below sticky scroll with padding, left of minimap and scrollbar
			const top = stickyScrollHeight + padding;
			const left = layoutInfo.width - width - layoutInfo.verticalScrollbarWidth - layoutInfo.minimap.minimapWidth - padding;

			this._position.set({
				preference: { top, left },
				stackOrdinal: 10000,
			}, undefined);
		}));

		// Create overlay widget
		this._showStore.add(this._editorObs.createOverlayWidget({
			domNode: this._domNode,
			position: this._position,
			minContentWidthInPx: this._minContentWidthInPx,
			allowEditorOverflow: false,
		}));
	}

	hide(): void {
		this._position.set(null, undefined);
		this._showStore.clear();
	}
}
