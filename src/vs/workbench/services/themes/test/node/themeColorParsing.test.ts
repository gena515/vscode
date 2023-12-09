/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess, Schemas } from 'vs/base/common/network';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ExtensionResourceLoaderService } from 'vs/platform/extensionResourceLoader/common/extensionResourceLoaderService';
import { FileService } from 'vs/platform/files/common/fileService';
import { NullLogService } from 'vs/platform/log/common/log';
import { IRequestService } from 'vs/platform/request/common/request';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ColorThemeData } from 'vs/workbench/services/themes/common/colorThemeData';
import { TestProductService, mock } from 'vs/workbench/test/common/workbenchTestServices';
import * as assert from 'assert';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { getColorRegistry } from 'vs/platform/theme/common/colorRegistry';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';


suite('Theme color parsing', () => {
	const fileService = new FileService(new NullLogService());
	const requestService = new (mock<IRequestService>())();
	const storageService = new (mock<IStorageService>())();
	const environmentService = new (mock<IEnvironmentService>())();
	const configurationService = new (mock<IConfigurationService>())();
	const extensionResourceLoaderService = new ExtensionResourceLoaderService(fileService, storageService, TestProductService, environmentService, configurationService, requestService);

	const diskFileSystemProvider = new DiskFileSystemProvider(new NullLogService());
	fileService.registerProvider(Schemas.file, diskFileSystemProvider);

	teardown(() => {
		diskFileSystemProvider.dispose();
	});


	test('parse with palette', async () => {
		const themeData = ColorThemeData.createUnloadedTheme('bar');
		themeData.location = FileAccess.asFileUri('vs/workbench/services/themes/test/node/color-theme-with-pallet.json');
		await themeData.ensureLoaded(extensionResourceLoaderService);
		const colorRegistry = getColorRegistry();

		assert.equal(themeData.isLoaded, true);
		assert.equal(themeData.getColor('editorGroup.emptyBackground')?.toString(), '#4e321a');
		assert.equal(themeData.getColor('statusBar.border')?.toString(), '#110802');
		assert.equal(themeData.getColor('focusBorder')?.toString(), '#0400ff');
		assert.equal(themeData.getColor('badge.background')?.toString(), '#fce566');

		const defaultBadgeForeground = colorRegistry.resolveDefaultColor('badge.foreground', themeData);
		assert.equal(themeData.getColor('badge.foreground')?.toString(), defaultBadgeForeground?.toString());

		assert.equal(themeData.getColor('editorGroup.dropBackground')?.toString(), '#ff0000');

	});

	test('parse without palette', async () => {
		const themeData = ColorThemeData.createUnloadedTheme('bar');
		themeData.location = FileAccess.asFileUri('vs/workbench/services/themes/test/node/color-theme-without-pallet.json');
		await themeData.ensureLoaded(extensionResourceLoaderService);
		const colorRegistry = getColorRegistry();

		assert.equal(themeData.isLoaded, true);
		assert.equal(themeData.getColor('editorGroup.emptyBackground')?.toString(), '#ff0000');

		assert.equal(themeData.getColor('statusBar.border')?.toString(), '#ff0000');

		assert.equal(themeData.getColor('focusBorder')?.toString(), '#0400ff');
		assert.equal(themeData.getColor('badge.background')?.toString(), '#fce566');

		const defaultBadgeForeground = colorRegistry.resolveDefaultColor('badge.foreground', themeData);
		assert.equal(themeData.getColor('badge.foreground')?.toString(), defaultBadgeForeground?.toString());

		assert.equal(themeData.getColor('editorGroup.dropBackground')?.toString(), '#ff0000');

	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
