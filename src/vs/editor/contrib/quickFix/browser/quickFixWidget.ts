/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { getDomNodePagePosition } from 'vs/base/browser/dom';
import { Position } from 'vs/editor/common/core/position';
import { IPosition } from 'vs/editor/common/editorCommon';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IQuickFix2 } from '../common/quickFix';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { Action } from 'vs/base/common/actions';

export class QuickFixContextMenu {

	private _editor: ICodeEditor;
	private _contextMenuService: IContextMenuService;
	private _commandService: ICommandService;
	private _visible: boolean;

	constructor(editor: ICodeEditor, contextMenuService: IContextMenuService, commandService: ICommandService) {
		this._editor = editor;
		this._contextMenuService = contextMenuService;
		this._commandService = commandService;
	}

	show(fixes: TPromise<IQuickFix2[]>, at: { x: number; y: number } | IPosition) {

		const actions = fixes.then(value => {
			return value.map(({command}) => {
				return new Action(command.id, command.title, undefined, true, () => {
					return this._commandService.executeCommand(command.id, ...command.arguments);
				});
			});
		});

		this._contextMenuService.showContextMenu({
			getAnchor: () => {
				if (Position.isIPosition(at)) {
					at = this._toCoords(at);
				}
				return at;
			},
			getActions: () => actions,
			onHide: () => { this._visible = false; }
		});
	}

	get isVisible(): boolean {
		return this._visible;
	}

	private _toCoords(position: IPosition): { x: number, y: number } {

		this._editor.revealPosition(position);
		this._editor.render();

		// Translate to absolute editor position
		const cursorCoords = this._editor.getScrolledVisiblePosition(this._editor.getPosition());
		const editorCoords = getDomNodePagePosition(this._editor.getDomNode());
		const x = editorCoords.left + cursorCoords.left;
		const y = editorCoords.top + cursorCoords.top + cursorCoords.height;

		return { x, y };
	}
}
