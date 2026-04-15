/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Agent-sessions color tokens.
//
// Registrations live here in the sessions layer. The workbench entry point
// (`workbench.common.main.ts`) imports this file as a side-effect so the
// tokens are present in the global color registry and JSON theme schema
// for both the main workbench and the sessions workbench.

import { localize } from '../../nls.js';
import { registerColor, transparent } from '../../platform/theme/common/colorUtils.js';
import { contrastBorder, focusBorder } from '../../platform/theme/common/colorRegistry.js';
import { editorWidgetBorder, editorBackground } from '../../platform/theme/common/colors/editorColors.js';
import { buttonBackground, inputBackground, inputBorder, inputForeground, inputPlaceholderForeground } from '../../platform/theme/common/colors/inputColors.js';
import { ACTIVITY_BAR_BADGE_BACKGROUND, ACTIVITY_BAR_BADGE_FOREGROUND, PANEL_ACTIVE_TITLE_BORDER, PANEL_ACTIVE_TITLE_FOREGROUND, PANEL_BORDER, PANEL_INACTIVE_TITLE_FOREGROUND, SIDE_BAR_BACKGROUND, SIDE_BAR_FOREGROUND } from '../../workbench/common/theme.js';

// ============================================================================
// Sidebar
// ============================================================================

export const sessionsSidebarBackground = registerColor(
	'sessionsSidebar.background',
	{ dark: editorBackground, light: SIDE_BAR_BACKGROUND, hcDark: editorBackground, hcLight: editorBackground },
	localize('sessionsSidebar.background', 'Background color of the sidebar in the agent sessions window.')
);

export const sessionsSidebarForeground = registerColor(
	'sessionsSidebar.foreground', SIDE_BAR_FOREGROUND,
	localize('sessionsSidebar.foreground', 'Foreground color of the sidebar in the agent sessions window.')
);

export const sessionsSidebarBorder = registerColor(
	'sessionsSidebar.border', PANEL_BORDER,
	localize('sessionsSidebar.border', 'Border color for section dividers within the sidebar in the agent sessions window.')
);

// ============================================================================
// Sidebar header
// ============================================================================

export const sessionsSidebarHeaderBackground = registerColor(
	'sessionsSidebarHeader.background', sessionsSidebarBackground,
	localize('sessionsSidebarHeader.background', 'Background color of the sidebar header area in the agent sessions window.')
);

export const sessionsSidebarHeaderForeground = registerColor(
	'sessionsSidebarHeader.foreground', SIDE_BAR_FOREGROUND,
	localize('sessionsSidebarHeader.foreground', 'Foreground color of the sidebar header area in the agent sessions window.')
);

// ============================================================================
// Auxiliary bar
// ============================================================================

export const sessionsAuxiliaryBarBackground = registerColor(
	'sessionsAuxiliaryBar.background',
	{ dark: SIDE_BAR_BACKGROUND, light: editorBackground, hcDark: SIDE_BAR_BACKGROUND, hcLight: SIDE_BAR_BACKGROUND },
	localize('sessionsAuxiliaryBar.background', 'Background color of the auxiliary bar in the agent sessions window.')
);

export const sessionsAuxiliaryBarForeground = registerColor(
	'sessionsAuxiliaryBar.foreground', SIDE_BAR_FOREGROUND,
	localize('sessionsAuxiliaryBar.foreground', 'Foreground color of the auxiliary bar in the agent sessions window.')
);

export const sessionsAuxiliaryBarBorder = registerColor(
	'sessionsAuxiliaryBar.border', PANEL_BORDER,
	localize('sessionsAuxiliaryBar.border', 'Border color of the auxiliary bar in the agent sessions window.')
);

// ============================================================================
// Panel
// ============================================================================

export const sessionsPanelBackground = registerColor(
	'sessionsPanel.background',
	{ dark: SIDE_BAR_BACKGROUND, light: editorBackground, hcDark: SIDE_BAR_BACKGROUND, hcLight: SIDE_BAR_BACKGROUND },
	localize('sessionsPanel.background', 'Background color of the panel in the agent sessions window.')
);

export const sessionsPanelForeground = registerColor(
	'sessionsPanel.foreground', SIDE_BAR_FOREGROUND,
	localize('sessionsPanel.foreground', 'Foreground color of the panel in the agent sessions window.')
);

export const sessionsPanelBorder = registerColor(
	'sessionsPanel.border', PANEL_BORDER,
	localize('sessionsPanel.border', 'Border color of the panel in the agent sessions window.')
);

// ============================================================================
// Chat panel
// ============================================================================

export const chatPanelBackground = registerColor(
	'chatPanel.background',
	{ dark: SIDE_BAR_BACKGROUND, light: editorBackground, hcDark: SIDE_BAR_BACKGROUND, hcLight: SIDE_BAR_BACKGROUND },
	localize('chatPanel.background', 'Background color of the chat panel in the agent sessions window.')
);

export const chatPanelForeground = registerColor(
	'chatPanel.foreground', SIDE_BAR_FOREGROUND,
	localize('chatPanel.foreground', 'Foreground color of the chat panel in the agent sessions window.')
);

export const chatPanelBorder = registerColor(
	'chatPanel.border', PANEL_BORDER,
	localize('chatPanel.border', 'Border color of the chat panel in the agent sessions window.')
);

// ============================================================================
// Chat panel title
// ============================================================================

export const chatPanelTitleBackground = registerColor(
	'chatPanelTitle.background', sessionsSidebarBackground,
	localize('chatPanelTitle.background', 'Background color of the chat panel title area in the agent sessions window.')
);

export const chatPanelTitleForeground = registerColor(
	'chatPanelTitle.foreground', SIDE_BAR_FOREGROUND,
	localize('chatPanelTitle.foreground', 'Foreground color of the chat panel title area in the agent sessions window.')
);

// ============================================================================
// Chat panel tabs
// ============================================================================

export const chatPanelTabActiveForeground = registerColor(
	'chatPanelTab.activeForeground', PANEL_ACTIVE_TITLE_FOREGROUND,
	localize('chatPanelTab.activeForeground', 'Foreground color of the active chat panel tab in the agent sessions window.')
);

export const chatPanelTabInactiveForeground = registerColor(
	'chatPanelTab.inactiveForeground', PANEL_INACTIVE_TITLE_FOREGROUND,
	localize('chatPanelTab.inactiveForeground', 'Foreground color of inactive chat panel tabs in the agent sessions window.')
);

export const chatPanelTabActiveBorder = registerColor(
	'chatPanelTab.activeBorder', PANEL_ACTIVE_TITLE_BORDER,
	localize('chatPanelTab.activeBorder', 'Border color of the active chat panel tab in the agent sessions window.')
);

// ============================================================================
// Card appearance
// ============================================================================

export const sessionsCardBorder = registerColor(
	'sessionsCard.border',
	{ dark: PANEL_BORDER, light: editorWidgetBorder, hcDark: contrastBorder, hcLight: contrastBorder },
	localize('sessionsCard.border', 'Border color of the card surfaces (chat bar, auxiliary bar, panel) in the agent sessions window.')
);

// ============================================================================
// Gradient background tint
// ============================================================================

export const sessionsGradientTintColor = registerColor(
	'sessionsGradient.tintColor', buttonBackground,
	localize('sessionsGradient.tintColor', 'Tint color used in the background gradient of the agent sessions window shell.')
);

// ============================================================================
// Agent feedback input widget
// ============================================================================

export const agentFeedbackInputWidgetBorder = registerColor(
	'agentFeedbackInputWidget.border',
	{ dark: editorWidgetBorder, light: editorWidgetBorder, hcDark: contrastBorder, hcLight: contrastBorder },
	localize('agentFeedbackInputWidget.border', 'Border color of the agent feedback input widget shown in the editor.')
);

// ============================================================================
// Update button
// ============================================================================

export const sessionsUpdateButtonDownloadingBackground = registerColor(
	'sessionsUpdateButton.downloadingBackground', transparent(buttonBackground, 0.4),
	localize('sessionsUpdateButton.downloadingBackground', 'Background color of the update button to show download progress in the agent sessions window.')
);

export const sessionsUpdateButtonDownloadedBackground = registerColor(
	'sessionsUpdateButton.downloadedBackground', transparent(buttonBackground, 0.7),
	localize('sessionsUpdateButton.downloadedBackground', 'Background color of the update button when download is complete in the agent sessions window.')
);

// ============================================================================
// Chat input
// ============================================================================

export const chatInputBackground = registerColor(
	'chatInput.background', inputBackground,
	localize('chatInput.background', 'Background color of the chat input field in the agent sessions window.')
);

export const chatInputForeground = registerColor(
	'chatInput.foreground', inputForeground,
	localize('chatInput.foreground', 'Foreground color of the chat input field in the agent sessions window.')
);

export const chatInputBorder = registerColor(
	'chatInput.border',
	{ dark: editorWidgetBorder, light: editorWidgetBorder, hcDark: contrastBorder, hcLight: contrastBorder },
	localize('chatInput.border', 'Border color of the chat input field in the agent sessions window.')
);

export const chatInputFocusBorder = registerColor(
	'chatInput.focusBorder', focusBorder,
	localize('chatInput.focusBorder', 'Border color of the chat input field when focused in the agent sessions window.')
);

export const chatInputPlaceholderForeground = registerColor(
	'chatInput.placeholderForeground', inputPlaceholderForeground,
	localize('chatInput.placeholderForeground', 'Placeholder text color in the chat input field in the agent sessions window.')
);

// ============================================================================
// Badge
// ============================================================================

export const sessionsBadgeBackground = registerColor(
	'sessionsBadge.background', ACTIVITY_BAR_BADGE_BACKGROUND,
	localize('sessionsBadge.background', 'Background color of badges in the agent sessions window.')
);

export const sessionsBadgeForeground = registerColor(
	'sessionsBadge.foreground', ACTIVITY_BAR_BADGE_FOREGROUND,
	localize('sessionsBadge.foreground', 'Foreground color of badges in the agent sessions window.')
);

// ============================================================================
// Unread session indicator
// ============================================================================

export const sessionsUnreadBadgeBackground = registerColor(
	'sessionsUnreadBadge.background', ACTIVITY_BAR_BADGE_BACKGROUND,
	localize('sessionsUnreadBadge.background', 'Background color of the unread sessions count badge on the sidebar toggle.')
);

export const sessionsUnreadBadgeForeground = registerColor(
	'sessionsUnreadBadge.foreground', ACTIVITY_BAR_BADGE_FOREGROUND,
	localize('sessionsUnreadBadge.foreground', 'Foreground color of the unread sessions count badge on the sidebar toggle.')
);

export const sessionsInputBorder = registerColor(
	'sessionsInput.border', inputBorder,
	localize('sessionsInput.border', 'Border color of input fields (e.g. new-chat input area) within the agent sessions window.')
);
