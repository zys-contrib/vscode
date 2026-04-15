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
import { ACTIVITY_BAR_BADGE_BACKGROUND, ACTIVITY_BAR_BADGE_FOREGROUND, PANEL_BORDER, SIDE_BAR_BACKGROUND, SIDE_BAR_FOREGROUND } from '../../workbench/common/theme.js';

// ============================================================================
// Shell background (used by the gradient system)
// ============================================================================

export const sessionsSidebarBackground = registerColor(
	'sessionsSidebar.background',
	{ dark: editorBackground, light: SIDE_BAR_BACKGROUND, hcDark: editorBackground, hcLight: editorBackground },
	localize('sessionsSidebar.background', 'Background color of the agent sessions window shell and gradient base.')
);

// ============================================================================
// Panels (chat panel, auxiliary bar, terminal panel)
// ============================================================================

export const sessionsPanelBackground = registerColor(
	'sessionsPanel.background',
	{ dark: SIDE_BAR_BACKGROUND, light: editorBackground, hcDark: SIDE_BAR_BACKGROUND, hcLight: SIDE_BAR_BACKGROUND },
	localize('sessionsPanel.background', 'Background color of the card panels (chat, files, terminal) in the agent sessions window.')
);

export const sessionsPanelForeground = registerColor(
	'sessionsPanel.foreground', SIDE_BAR_FOREGROUND,
	localize('sessionsPanel.foreground', 'Foreground color of the card panels (chat, files, terminal) in the agent sessions window.')
);

export const sessionsPanelBorder = registerColor(
	'sessionsPanel.border',
	{ dark: PANEL_BORDER, light: editorWidgetBorder, hcDark: contrastBorder, hcLight: contrastBorder },
	localize('sessionsPanel.border', 'Border color of the card panels (chat, files, terminal) in the agent sessions window.')
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

export const sessionsChatInputBackground = registerColor(
	'sessionsChatInput.background', inputBackground,
	localize('sessionsChatInput.background', 'Background color of the chat input field in the agent sessions window.')
);

export const sessionsChatInputForeground = registerColor(
	'sessionsChatInput.foreground', inputForeground,
	localize('sessionsChatInput.foreground', 'Foreground color of the chat input field in the agent sessions window.')
);

export const sessionsChatInputBorder = registerColor(
	'sessionsChatInput.border', inputBorder,
	localize('sessionsChatInput.border', 'Border color of the chat input field in the agent sessions window.')
);

export const sessionsChatInputFocusBorder = registerColor(
	'sessionsChatInput.focusBorder', focusBorder,
	localize('sessionsChatInput.focusBorder', 'Border color of the chat input field when focused in the agent sessions window.')
);

export const sessionsChatInputPlaceholderForeground = registerColor(
	'sessionsChatInput.placeholderForeground', inputPlaceholderForeground,
	localize('sessionsChatInput.placeholderForeground', 'Placeholder text color in the chat input field in the agent sessions window.')
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
