/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isString } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import * as pfs from 'vs/base/node/pfs';

export function getIconFromPath(iconPath?: string | URI | { light: URI; dark: URI } | ThemeIcon): string {
	if (!iconPath) {
		return '';
	} else if (isString(iconPath)) {
		return iconPath;
	} else if ('light' in iconPath) {
		if (pfs.SymlinkSupport.existsFile(iconPath.light.toString()) && pfs.SymlinkSupport.existsFile(iconPath.dark.toString())) {
			return iconPath.light.toString();
		} else {
			return '';
		}
	} else if (pfs.SymlinkSupport.existsFile(iconPath.toString())) {
		return iconPath.toString();
	}
	return '';
}
