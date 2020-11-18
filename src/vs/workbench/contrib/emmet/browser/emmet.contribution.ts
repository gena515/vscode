/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerEditorCommand } from 'vs/editor/browser/editorExtensions';
import { ExpandEmmetAbbreviationCommand } from './expandEmmetAbbreviation';

registerEditorCommand(new ExpandEmmetAbbreviationCommand());
