/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { CSSIcon } from 'vs/base/common/codicons';

const labelWithIconsRegex = new RegExp(`(\\\\)?\\$\\((${CSSIcon.iconNameExpression}(?:${CSSIcon.iconModifierExpression})?)\\)`, 'g');
export function renderLabelWithIcons(text: string, secondaryIconId?: string): Array<HTMLSpanElement | string> {
	const elements = new Array<HTMLSpanElement | string>();
	let match: RegExpMatchArray | null;

	let textStart = 0, textStop = 0;
	while ((match = labelWithIconsRegex.exec(text)) !== null) {
		textStop = match.index || 0;
		elements.push(text.substring(textStart, textStop));
		textStart = (match.index || 0) + match[0].length;

		const [, escaped, codicon] = match;
		elements.push(escaped ? `$(${codicon})` : renderIcon({ id: codicon }, secondaryIconId));
		if (secondaryIconId) {
			const secondaryIcon = renderIcon({ id: secondaryIconId });
			secondaryIcon.style.position = 'absolute';
			secondaryIcon.style.top = '10px';
			secondaryIcon.style.left = '10px';
			secondaryIcon.style.fontSize = '8px';
			secondaryIcon.style.color = '#990';
			elements.push(secondaryIcon);
		}
	}

	if (textStart < text.length) {
		elements.push(text.substring(textStart));
	}
	return elements;
}

export function renderIcon(icon: CSSIcon, secondaryIconId?: string): HTMLSpanElement {
	const node = dom.$(`span`);
	node.classList.add(...CSSIcon.asClassNameArray(icon));
	if (secondaryIconId) {
		node.style.verticalAlign = 'text-bottom';
		node.style.clipPath = 'polygon(0% 0%, 100% 0%, 100% 60%, 60% 60%, 60% 100%, 0% 100%)';
		node.style.marginRight = '2px';
	}
	return node;
}
