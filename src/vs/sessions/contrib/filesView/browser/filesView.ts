/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/filesView.css';
import * as dom from '../../../../base/browser/dom.js';
import { IListVirtualDelegate } from '../../../../base/browser/ui/list/list.js';
import { ITreeNode, IAsyncDataSource } from '../../../../base/browser/ui/tree/tree.js';
import { ITreeRenderer } from '../../../../base/browser/ui/tree/tree.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { derived, observableValue } from '../../../../base/common/observable.js';
import { autorun } from '../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { FileKind, IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { WorkbenchAsyncDataTree } from '../../../../platform/list/browser/listService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IResourceLabel, ResourceLabels } from '../../../../workbench/browser/labels.js';
import { IViewPaneOptions, ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../../workbench/common/views.js';
import { createFileIconThemableTreeContainerScope } from '../../../../workbench/contrib/files/browser/views/explorerView.js';
import { ACTIVE_GROUP, IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { ISessionsManagementService } from '../../sessions/browser/sessionsManagementService.js';

const $ = dom.$;

// --- Constants

export const FILES_VIEW_ID = 'workbench.view.agentSessions.files';

// --- Tree Element

interface IFileTreeElement {
	readonly resource: URI;
	readonly name: string;
	readonly isDirectory: boolean;
}

// --- Data Source

class FilesDataSource implements IAsyncDataSource<URI, IFileTreeElement> {
	constructor(
		private readonly fileService: IFileService,
	) { }

	hasChildren(element: URI | IFileTreeElement): boolean {
		if (URI.isUri(element)) {
			return true; // root is always expandable
		}
		return element.isDirectory;
	}

	async getChildren(element: URI | IFileTreeElement): Promise<IFileTreeElement[]> {
		const uri = URI.isUri(element) ? element : element.resource;

		try {
			const stat = await this.fileService.resolve(uri);
			if (!stat.children) {
				return [];
			}

			return stat.children
				.map(child => ({
					resource: child.resource,
					name: child.name,
					isDirectory: child.isDirectory,
				}))
				.sort((a, b) => {
					// Directories first, then alphabetical
					if (a.isDirectory !== b.isDirectory) {
						return a.isDirectory ? -1 : 1;
					}
					return a.name.localeCompare(b.name);
				});
		} catch {
			return [];
		}
	}
}

// --- Delegate

class FilesTreeDelegate implements IListVirtualDelegate<IFileTreeElement> {
	getHeight(): number {
		return 22;
	}

	getTemplateId(): string {
		return FilesTreeRenderer.TEMPLATE_ID;
	}
}

// --- Renderer

interface IFilesTreeTemplate {
	readonly label: IResourceLabel;
	readonly templateDisposables: DisposableStore;
}

class FilesTreeRenderer implements ITreeRenderer<IFileTreeElement, void, IFilesTreeTemplate> {
	static readonly TEMPLATE_ID = 'filesTreeRenderer';
	readonly templateId = FilesTreeRenderer.TEMPLATE_ID;

	constructor(
		private readonly labels: ResourceLabels,
	) { }

	renderTemplate(container: HTMLElement): IFilesTreeTemplate {
		const templateDisposables = new DisposableStore();
		const label = templateDisposables.add(this.labels.create(container, { supportHighlights: true, supportIcons: true }));
		return { label, templateDisposables };
	}

	renderElement(node: ITreeNode<IFileTreeElement, void>, _index: number, templateData: IFilesTreeTemplate): void {
		const element = node.element;
		templateData.label.element.style.display = 'flex';

		if (element.isDirectory) {
			templateData.label.setResource({ resource: element.resource, name: element.name }, {
				fileKind: FileKind.FOLDER,
			});
		} else {
			templateData.label.setFile(element.resource, {
				fileKind: FileKind.FILE,
				hidePath: true,
			});
		}
	}

	disposeTemplate(templateData: IFilesTreeTemplate): void {
		templateData.templateDisposables.dispose();
	}
}

// --- View Pane

export class FilesViewPane extends ViewPane {

	private bodyContainer: HTMLElement | undefined;
	private welcomeContainer: HTMLElement | undefined;
	private treeContainer: HTMLElement | undefined;
	private tree: WorkbenchAsyncDataTree<URI, IFileTreeElement> | undefined;

	private readonly renderDisposables = this._register(new DisposableStore());

	private currentBodyHeight = 0;
	private currentBodyWidth = 0;

	// Track the root URI for the file tree reactively
	private readonly rootUri = observableValue<URI | undefined>(this, undefined);

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
		@ISessionsManagementService private readonly sessionManagementService: ISessionsManagementService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// Derive root URI from active session
		const rootUriDerived = derived(this, reader => {
			const activeSession = this.sessionManagementService.activeSession.read(reader);
			if (!activeSession) {
				return undefined;
			}
			return activeSession.worktree ?? activeSession.repository;
		});

		this._register(autorun(reader => {
			this.rootUri.set(rootUriDerived.read(reader), undefined);
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.bodyContainer = dom.append(container, $('.files-view-body'));

		// Welcome message for empty state
		this.welcomeContainer = dom.append(this.bodyContainer, $('.files-welcome'));
		const welcomeIcon = dom.append(this.welcomeContainer, $('.files-welcome-icon'));
		welcomeIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.folder));
		const welcomeMessage = dom.append(this.welcomeContainer, $('.files-welcome-message'));
		welcomeMessage.textContent = localize('filesView.noFiles', "No repository files available.");

		// Tree container with file icons
		this.treeContainer = dom.append(this.bodyContainer, $('.files-tree-container.show-file-icons'));
		this._register(createFileIconThemableTreeContainerScope(this.treeContainer, this.themeService));

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible) {
				this.onVisible();
			} else {
				this.renderDisposables.clear();
			}
		}));

		if (this.isBodyVisible()) {
			this.onVisible();
		}
	}

	private onVisible(): void {
		this.renderDisposables.clear();

		// Create the tree if not already created
		if (!this.tree && this.treeContainer) {
			const resourceLabels = this._register(this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this.onDidChangeBodyVisibility }));
			this.tree = this.instantiationService.createInstance(
				WorkbenchAsyncDataTree<URI, IFileTreeElement>,
				'FilesViewTree',
				this.treeContainer,
				new FilesTreeDelegate(),
				[new FilesTreeRenderer(resourceLabels)],
				new FilesDataSource(this.fileService),
				{
					accessibilityProvider: {
						getAriaLabel: (element: IFileTreeElement) => element.name,
						getWidgetAriaLabel: () => localize('filesViewTree', "Files Tree")
					},
					identityProvider: {
						getId: (element: IFileTreeElement) => element.resource.toString()
					},
				}
			);

			// Open file on click
			this.renderDisposables.add(this.tree.onDidOpen(async (e) => {
				if (!e.element || e.element.isDirectory) {
					return;
				}

				await this.editorService.openEditor({
					resource: e.element.resource,
					options: e.editorOptions
				}, ACTIVE_GROUP);
			}));
		}

		// React to root URI changes
		this.renderDisposables.add(autorun(reader => {
			const root = this.rootUri.read(reader);

			if (!root) {
				dom.setVisibility(false, this.treeContainer!);
				dom.setVisibility(true, this.welcomeContainer!);
				return;
			}

			dom.setVisibility(true, this.treeContainer!);
			dom.setVisibility(false, this.welcomeContainer!);

			if (this.tree) {
				this.tree.setInput(root).then(() => {
					this.layoutTree();
				});
			}
		}));
	}

	private layoutTree(): void {
		if (!this.tree || this.currentBodyHeight <= 0) {
			return;
		}

		this.tree.layout(this.currentBodyHeight, this.currentBodyWidth);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.currentBodyHeight = height;
		this.currentBodyWidth = width;
		this.layoutTree();
	}

	async refresh(): Promise<void> {
		if (this.tree) {
			const root = this.rootUri.get();
			if (root) {
				await this.tree.setInput(root);
			}
		}
	}

	override focus(): void {
		super.focus();
		this.tree?.domFocus();
	}

	override dispose(): void {
		this.tree?.dispose();
		this.tree = undefined;
		super.dispose();
	}
}

// Re-export for contribution file
export const FILES_VIEW_TITLE = localize2('files', "Files");
