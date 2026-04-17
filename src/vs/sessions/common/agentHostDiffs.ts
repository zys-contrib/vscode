/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../base/common/uri.js';
import { SessionStatus as ProtocolSessionStatus, type ISessionFileDiff } from '../../platform/agentHost/common/state/protocol/state.js';
import { SessionStatus } from '../services/sessions/common/session.js';

/**
 * Maps the protocol-layer session status bitset to the UI-layer
 * {@link SessionStatus} enum used by session adapters.
 */
export function mapProtocolStatus(protocol: ProtocolSessionStatus): SessionStatus {
	if ((protocol & ProtocolSessionStatus.InputNeeded) === ProtocolSessionStatus.InputNeeded) {
		return SessionStatus.NeedsInput;
	}
	if (protocol & ProtocolSessionStatus.InProgress) {
		return SessionStatus.InProgress;
	}
	if (protocol & ProtocolSessionStatus.Error) {
		return SessionStatus.Error;
	}
	return SessionStatus.Completed;
}

export interface IFileChange {
	readonly modifiedUri: URI;
	readonly insertions: number;
	readonly deletions: number;
}

/**
 * Converts agent host diffs to the chat session file change format.
 *
 * @param mapUri Optional URI mapper applied after parsing. The remote agent
 *   host provider uses this to rewrite `file:` URIs into agent-host URIs.
 */
export function diffsToChanges(diffs: readonly ISessionFileDiff[], mapUri?: (uri: URI) => URI): IFileChange[] {
	return diffs.map(d => ({
		modifiedUri: mapUri ? mapUri(URI.parse(d.uri)) : URI.parse(d.uri),
		insertions: d.added ?? 0,
		deletions: d.removed ?? 0,
	}));
}

/**
 * Returns `true` when the current file changes already
 * match the incoming diffs, avoiding unnecessary observable updates.
 */
export function diffsEqual(current: readonly IFileChange[], diffs: readonly ISessionFileDiff[], mapUri?: (uri: URI) => URI): boolean {
	if (current.length !== diffs.length) {
		return false;
	}
	for (let i = 0; i < current.length; i++) {
		const c = current[i];
		const d = diffs[i];
		const parsed = URI.parse(d.uri);
		const diffUri = mapUri ? mapUri(parsed) : parsed;
		if (c.modifiedUri.toString() !== diffUri.toString() || c.insertions !== (d.added ?? 0) || c.deletions !== (d.removed ?? 0)) {
			return false;
		}
	}
	return true;
}
