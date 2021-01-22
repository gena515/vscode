/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { MessageBoxOptions, MessageBoxReturnValue, SaveDialogOptions, SaveDialogReturnValue, OpenDialogOptions, OpenDialogReturnValue, dialog, FileFilter, BrowserWindow } from 'electron';
import { Queue } from 'vs/base/common/async';
import { IStateService } from 'vs/platform/state/node/state';
import { isMacintosh } from 'vs/base/common/platform';
import { dirname } from 'vs/base/common/path';
import { normalizeNFC } from 'vs/base/common/normalization';
import { exists } from 'vs/base/node/pfs';
import { INativeOpenDialogOptions } from 'vs/platform/dialogs/common/dialogs';
import { withNullAsUndefined } from 'vs/base/common/types';
import { localize } from 'vs/nls';
import { WORKSPACE_FILTER } from 'vs/platform/workspaces/common/workspaces';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { Disposable, dispose, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { hash } from 'vs/base/common/hash';

export const IDialogMainService = createDecorator<IDialogMainService>('dialogMainService');

export interface IDialogMainService {

	readonly _serviceBrand: undefined;

	pickFileFolder(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined>;
	pickFolder(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined>;
	pickFile(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined>;
	pickWorkspace(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined>;

	showMessageBox(options: MessageBoxOptions, window?: BrowserWindow): Promise<MessageBoxReturnValue>;
	showSaveDialog(options: SaveDialogOptions, window?: BrowserWindow): Promise<SaveDialogReturnValue>;
	showOpenDialog(options: OpenDialogOptions, window?: BrowserWindow): Promise<OpenDialogReturnValue>;
}

interface IInternalNativeOpenDialogOptions extends INativeOpenDialogOptions {
	pickFolders?: boolean;
	pickFiles?: boolean;

	title: string;
	buttonLabel?: string;
	filters?: FileFilter[];
}

export class DialogMainService implements IDialogMainService {

	declare readonly _serviceBrand: undefined;

	private static readonly workingDirPickerStorageKey = 'pickerWorkingDir';

	private readonly windowDialogLocks = new Map<number, Set<number>>();
	private readonly windowDialogQueues = new Map<number, Queue<any>>();
	private readonly noWindowDialogueQueue = new Queue<any>();

	constructor(
		@IStateService private readonly stateService: IStateService
	) {
	}

	pickFileFolder(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined> {
		return this.doPick({ ...options, pickFolders: true, pickFiles: true, title: localize('open', "Open") }, window);
	}

	pickFolder(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined> {
		return this.doPick({ ...options, pickFolders: true, title: localize('openFolder', "Open Folder") }, window);
	}

	pickFile(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined> {
		return this.doPick({ ...options, pickFiles: true, title: localize('openFile', "Open File") }, window);
	}

	pickWorkspace(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined> {
		const title = localize('openWorkspaceTitle', "Open Workspace");
		const buttonLabel = mnemonicButtonLabel(localize({ key: 'openWorkspace', comment: ['&& denotes a mnemonic'] }, "&&Open"));
		const filters = WORKSPACE_FILTER;

		return this.doPick({ ...options, pickFiles: true, title, filters, buttonLabel }, window);
	}

	private async doPick(options: IInternalNativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined> {

		// Ensure dialog options
		const dialogOptions: OpenDialogOptions = {
			title: options.title,
			buttonLabel: options.buttonLabel,
			filters: options.filters
		};

		// Ensure defaultPath
		dialogOptions.defaultPath = options.defaultPath || this.stateService.getItem<string>(DialogMainService.workingDirPickerStorageKey);


		// Ensure properties
		if (typeof options.pickFiles === 'boolean' || typeof options.pickFolders === 'boolean') {
			dialogOptions.properties = undefined; // let it override based on the booleans

			if (options.pickFiles && options.pickFolders) {
				dialogOptions.properties = ['multiSelections', 'openDirectory', 'openFile', 'createDirectory'];
			}
		}

		if (!dialogOptions.properties) {
			dialogOptions.properties = ['multiSelections', options.pickFolders ? 'openDirectory' : 'openFile', 'createDirectory'];
		}

		if (isMacintosh) {
			dialogOptions.properties.push('treatPackageAsDirectory'); // always drill into .app files
		}

		// Show Dialog
		const windowToUse = window || BrowserWindow.getFocusedWindow();

		const result = await this.showOpenDialog(dialogOptions, withNullAsUndefined(windowToUse));
		if (result && result.filePaths && result.filePaths.length > 0) {

			// Remember path in storage for next time
			this.stateService.setItem(DialogMainService.workingDirPickerStorageKey, dirname(result.filePaths[0]));

			return result.filePaths;
		}

		return;
	}

	async showMessageBox(options: MessageBoxOptions, window?: BrowserWindow): Promise<MessageBoxReturnValue> {

		// prevent duplicates of the same dialog queueing at the same time
		const fileDialogLock = await this.acquireFileDialogLock(options, window);
		if (!fileDialogLock) {
			throw new Error('A dialog is already showing for the window');
		}

		const dialogResult = await this.getWindowDialogQueue<MessageBoxReturnValue>(window).queue(async () => {
			if (window) {
				return dialog.showMessageBox(window, options);
			}

			return dialog.showMessageBox(options);
		});

		try {
			return dialogResult;
		} finally {
			dispose(fileDialogLock);
		}
	}

	private getWindowDialogQueue<T>(window?: BrowserWindow): Queue<T> {

		// Queue message box requests per window so that one can show
		// after the other.
		if (window) {
			let windowDialogQueue = this.windowDialogQueues.get(window.id);
			if (!windowDialogQueue) {
				windowDialogQueue = new Queue<T>();
				this.windowDialogQueues.set(window.id, windowDialogQueue);
			}

			return windowDialogQueue;
		} else {
			return this.noWindowDialogueQueue;
		}
	}

	async showSaveDialog(options: SaveDialogOptions, window?: BrowserWindow): Promise<SaveDialogReturnValue> {

		function normalizePath(path: string | undefined): string | undefined {
			if (path && isMacintosh) {
				path = normalizeNFC(path); // normalize paths returned from the OS
			}

			return path;
		}

		// prevent duplicates of the same dialog queueing at the same time
		const fileDialogLock = await this.acquireFileDialogLock(options, window);
		if (!fileDialogLock) {
			throw new Error('A dialog is already showing for the window');
		}

		const dialogResult = await this.getWindowDialogQueue<SaveDialogReturnValue>(window).queue(async () => {
			let result: SaveDialogReturnValue;
			if (window) {
				result = await dialog.showSaveDialog(window, options);
			} else {
				result = await dialog.showSaveDialog(options);
			}

			result.filePath = normalizePath(result.filePath);

			return result;
		});

		try {
			return dialogResult;
		} finally {
			dispose(fileDialogLock);
		}
	}

	async showOpenDialog(options: OpenDialogOptions, window?: BrowserWindow): Promise<OpenDialogReturnValue> {

		function normalizePaths(paths: string[]): string[] {
			if (paths && paths.length > 0 && isMacintosh) {
				paths = paths.map(path => normalizeNFC(path)); // normalize paths returned from the OS
			}

			return paths;
		}

		// Ensure the path exists (if provided)
		if (options.defaultPath) {
			const pathExists = await exists(options.defaultPath);
			if (!pathExists) {
				options.defaultPath = undefined;
			}
		}

		// prevent duplicates of the same dialog queueing at the same time
		const fileDialogLock = await this.acquireFileDialogLock(options, window);
		if (!fileDialogLock) {
			throw new Error('A dialog is already showing for the window');
		}

		const dialogResult = await this.getWindowDialogQueue<OpenDialogReturnValue>(window).queue(async () => {
			let result: OpenDialogReturnValue;
			if (window) {
				result = await dialog.showOpenDialog(window, options);
			} else {
				result = await dialog.showOpenDialog(options);
			}

			result.filePaths = normalizePaths(result.filePaths);

			return result;
		});

		try {
			return dialogResult;
		} finally {
			dispose(fileDialogLock);
		}
	}

	private async acquireFileDialogLock(options: any = {}, window?: BrowserWindow): Promise<IDisposable | undefined> {

		// if no window is provided, allow as many dialogs as
		// needed since we consider them not modal per window
		if (!window) {
			return Disposable.None;
		}

		// if a window is provided, only allow a single dialog
		// at the same time because dialogs are modal and we
		// do not want to open one dialog after the other
		// (https://github.com/microsoft/vscode/issues/114432)
		let windowDialogLocks = this.windowDialogLocks.get(window.id);
		const optionsHash = hash(options);

		if (windowDialogLocks?.has(optionsHash)) {
			return undefined;
		}

		if (!windowDialogLocks) {
			windowDialogLocks = new Set([optionsHash]);
			this.windowDialogLocks.set(window.id, windowDialogLocks);
		}
		windowDialogLocks.add(optionsHash);

		return toDisposable(() => {
			const windowDialogLocks = this.windowDialogLocks.get(window.id);
			windowDialogLocks?.delete(optionsHash);

			// if there's no more dialogs in the window's queue, delete the queue
			if (!this.windowDialogLocks.get(window.id)?.size) {
				this.windowDialogLocks.delete(window.id);
			}
		});
	}
}
