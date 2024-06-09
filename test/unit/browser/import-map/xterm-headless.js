/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { importAmdModule, root } from './amdx.js';

const module = await importAmdModule(
	`${root}/node_modules/@xterm/headless/lib-headless/xterm-headless.js`,
);

const { Terminal } = module;

export { Terminal };

export default module;
