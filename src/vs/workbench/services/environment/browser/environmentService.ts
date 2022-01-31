/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'vs/base/common/network';
import { joinPath } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { ExtensionKind, IEnvironmentService, IExtensionHostDebugParams } from 'vs/platform/environment/common/environment';
import { IPath, IWindowConfiguration } from 'vs/platform/windows/common/windows';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IWorkbenchConstructionOptions } from 'vs/workbench/browser/web.api';
import { IProductService } from 'vs/platform/product/common/productService';
import { memoize } from 'vs/base/common/decorators';
import { onUnexpectedError } from 'vs/base/common/errors';
import { parseLineAndColumnAware } from 'vs/base/common/extpath';
import { LogLevelToString } from 'vs/platform/log/common/log';
import { isUndefined } from 'vs/base/common/types';
import { refineServiceDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IBrowserWorkbenchEnvironmentService = refineServiceDecorator<IEnvironmentService, IBrowserWorkbenchEnvironmentService>(IEnvironmentService);

/**
 * A subclass of the `IWorkbenchEnvironmentService` to be used only environments
 * where the web API is available (browsers, Electron).
 */
export interface IBrowserWorkbenchEnvironmentService extends IWorkbenchEnvironmentService {

	/**
	 * Options used to configure the workbench.
	 */
	readonly options?: IWorkbenchConstructionOptions;
}

class BrowserWorkbenchConfiguration implements IWindowConfiguration {

	constructor(
		private readonly options: IWorkbenchConstructionOptions
	) { }

	@memoize
	get remoteAuthority(): string | undefined { return this.options.remoteAuthority; }
}

interface IExtensionHostDebugEnvironment {
	params: IExtensionHostDebugParams;
	debugRenderer: boolean;
	isExtensionDevelopment: boolean;
	extensionDevelopmentLocationURI?: URI[];
	extensionDevelopmentKind?: ExtensionKind[];
	extensionTestsLocationURI?: URI;
	extensionEnabledProposedApi?: string[];
}

export class BrowserWorkbenchEnvironmentService implements IBrowserWorkbenchEnvironmentService {

	declare readonly _serviceBrand: undefined;

	private _configuration: IWindowConfiguration | undefined = undefined;
	get configuration2(): IWindowConfiguration {
		if (!this._configuration) {
			this._configuration = new BrowserWorkbenchConfiguration(this.options);
		}

		return this._configuration;
	}

	@memoize
	get remoteAuthority(): string | undefined { return this.options.remoteAuthority; }

	@memoize
	get isBuilt(): boolean { return !!this.productService.commit; }

	@memoize
	get logsPath(): string { return this.logsHome.path; }

	@memoize
	get logLevel(): string | undefined { return this.payload?.get('logLevel') || (this.options.developmentOptions?.logLevel !== undefined ? LogLevelToString(this.options.developmentOptions?.logLevel) : undefined); }

	@memoize
	get logFile(): URI { return joinPath(this.logsHome, 'window.log'); }

	@memoize
	get userRoamingDataHome(): URI { return URI.file('/User').with({ scheme: Schemas.userData }); }

	@memoize
	get settingsResource(): URI { return joinPath(this.userRoamingDataHome, 'settings.json'); }

	@memoize
	get argvResource(): URI { return joinPath(this.userRoamingDataHome, 'argv.json'); }

	@memoize
	get snippetsHome(): URI { return joinPath(this.userRoamingDataHome, 'snippets'); }

	@memoize
	get cacheHome(): URI { return joinPath(this.userRoamingDataHome, 'caches'); }

	@memoize
	get globalStorageHome(): URI { return URI.joinPath(this.userRoamingDataHome, 'globalStorage'); }

	@memoize
	get workspaceStorageHome(): URI { return URI.joinPath(this.userRoamingDataHome, 'workspaceStorage'); }

	/**
	 * In Web every workspace can potentially have scoped user-data
	 * and/or extensions and if Sync state is shared then it can make
	 * Sync error prone - say removing extensions from another workspace.
	 * Hence scope Sync state per workspace. Sync scoped to a workspace
	 * is capable of handling opening same workspace in multiple windows.
	 */
	@memoize
	get userDataSyncHome(): URI { return joinPath(this.userRoamingDataHome, 'sync', this.workspaceId); }

	@memoize
	get userDataSyncLogResource(): URI { return joinPath(this.logsHome, 'userDataSync.log'); }

	@memoize
	get sync(): 'on' | 'off' | undefined { return undefined; }

	@memoize
	get keybindingsResource(): URI { return joinPath(this.userRoamingDataHome, 'keybindings.json'); }

	@memoize
	get keyboardLayoutResource(): URI { return joinPath(this.userRoamingDataHome, 'keyboardLayout.json'); }

	@memoize
	get untitledWorkspacesHome(): URI { return joinPath(this.userRoamingDataHome, 'Workspaces'); }

	@memoize
	get serviceMachineIdResource(): URI { return joinPath(this.userRoamingDataHome, 'machineid'); }

	@memoize
	get extHostLogsPath(): URI { return joinPath(this.logsHome, 'exthost'); }

	private _extensionHostDebugEnvironment: IExtensionHostDebugEnvironment | undefined = undefined;
	get debugExtensionHost(): IExtensionHostDebugParams {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.params;
	}

	get isExtensionDevelopment(): boolean {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.isExtensionDevelopment;
	}

	get extensionDevelopmentLocationURI(): URI[] | undefined {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.extensionDevelopmentLocationURI;
	}

	get extensionDevelopmentLocationKind(): ExtensionKind[] | undefined {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.extensionDevelopmentKind;
	}

	get extensionTestsLocationURI(): URI | undefined {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.extensionTestsLocationURI;
	}

	get extensionEnabledProposedApi(): string[] | undefined {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.extensionEnabledProposedApi;
	}

	get debugRenderer(): boolean {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.debugRenderer;
	}

	get disableExtensions() { return this.payload?.get('disableExtensions') === 'true'; }

	get enableExtensions() { return this.options.enabledExtensions; }

	@memoize
	get webviewExternalEndpoint(): string {
		const endpoint = this.options.webviewEndpoint
			|| this.productService.webviewContentExternalBaseUrlTemplate
			|| 'https://{{uuid}}.vscode-webview.net/{{quality}}/{{commit}}/out/vs/workbench/contrib/webview/browser/pre/';

		const webviewExternalEndpointCommit = this.payload?.get('webviewExternalEndpointCommit');
		return endpoint
			.replace('{{commit}}', webviewExternalEndpointCommit ?? this.productService.commit ?? 'd372f9187401bd145a0a6e15ba369e2d82d02005')
			.replace('{{quality}}', (webviewExternalEndpointCommit ? 'insider' : this.productService.quality) ?? 'insider');
	}

	@memoize
	get telemetryLogResource(): URI { return joinPath(this.logsHome, 'telemetry.log'); }
	get disableTelemetry(): boolean { return false; }

	get verbose(): boolean { return this.payload?.get('verbose') === 'true'; }
	get logExtensionHostCommunication(): boolean { return this.payload?.get('logExtensionHostCommunication') === 'true'; }

	get skipReleaseNotes(): boolean { return false; }
	get skipWelcome(): boolean { return this.payload?.get('skipWelcome') === 'true'; }

	@memoize
	get disableWorkspaceTrust(): boolean { return true; }

	private payload: Map<string, string> | undefined;

	constructor(
		private readonly workspaceId: string,
		private readonly logsHome: URI,
		readonly options: IWorkbenchConstructionOptions,
		private readonly productService: IProductService
	) {
		if (options.workspaceProvider && Array.isArray(options.workspaceProvider.payload)) {
			try {
				this.payload = new Map(options.workspaceProvider.payload);
			} catch (error) {
				onUnexpectedError(error); // possible invalid payload for map
			}
		}
	}

	private resolveExtensionHostDebugEnvironment(): IExtensionHostDebugEnvironment {
		const extensionHostDebugEnvironment: IExtensionHostDebugEnvironment = {
			params: {
				port: null,
				break: false
			},
			debugRenderer: false,
			isExtensionDevelopment: false,
			extensionDevelopmentLocationURI: undefined,
			extensionDevelopmentKind: undefined
		};

		// Fill in selected extra environmental properties
		if (this.payload) {
			for (const [key, value] of this.payload) {
				switch (key) {
					case 'extensionDevelopmentPath':
						if (!extensionHostDebugEnvironment.extensionDevelopmentLocationURI) {
							extensionHostDebugEnvironment.extensionDevelopmentLocationURI = [];
						}
						extensionHostDebugEnvironment.extensionDevelopmentLocationURI.push(URI.parse(value));
						extensionHostDebugEnvironment.isExtensionDevelopment = true;
						break;
					case 'extensionDevelopmentKind':
						extensionHostDebugEnvironment.extensionDevelopmentKind = [<ExtensionKind>value];
						break;
					case 'extensionTestsPath':
						extensionHostDebugEnvironment.extensionTestsLocationURI = URI.parse(value);
						break;
					case 'debugRenderer':
						extensionHostDebugEnvironment.debugRenderer = value === 'true';
						break;
					case 'debugId':
						extensionHostDebugEnvironment.params.debugId = value;
						break;
					case 'inspect-brk-extensions':
						extensionHostDebugEnvironment.params.port = parseInt(value);
						extensionHostDebugEnvironment.params.break = true;
						break;
					case 'inspect-extensions':
						extensionHostDebugEnvironment.params.port = parseInt(value);
						break;
					case 'enableProposedApi':
						extensionHostDebugEnvironment.extensionEnabledProposedApi = [];
						break;
				}
			}
		}

		const developmentOptions = this.options.developmentOptions;
		if (developmentOptions && !extensionHostDebugEnvironment.isExtensionDevelopment) {
			if (developmentOptions.extensions?.length) {
				extensionHostDebugEnvironment.extensionDevelopmentLocationURI = developmentOptions.extensions.map(e => URI.revive(e));
				extensionHostDebugEnvironment.isExtensionDevelopment = true;
			}
			if (developmentOptions.extensionTestsPath) {
				extensionHostDebugEnvironment.extensionTestsLocationURI = URI.revive(developmentOptions.extensionTestsPath);
			}
		}

		return extensionHostDebugEnvironment;
	}

	@memoize
	get filesToOpenOrCreate(): IPath[] | undefined {
		if (this.payload) {
			const fileToOpen = this.payload.get('openFile');
			if (fileToOpen) {
				const fileUri = URI.parse(fileToOpen);

				// Support: --goto parameter to open on line/col
				if (this.payload.has('gotoLineMode')) {
					const pathColumnAware = parseLineAndColumnAware(fileUri.path);

					return [{
						fileUri: fileUri.with({ path: pathColumnAware.path }),
						selection: !isUndefined(pathColumnAware.line) ? { startLineNumber: pathColumnAware.line, startColumn: pathColumnAware.column || 1 } : undefined
					}];
				}

				return [{ fileUri }];
			}
		}

		return undefined;
	}

	@memoize
	get filesToDiff(): IPath[] | undefined {
		if (this.payload) {
			const fileToDiffPrimary = this.payload.get('diffFilePrimary');
			const fileToDiffSecondary = this.payload.get('diffFileSecondary');
			if (fileToDiffPrimary && fileToDiffSecondary) {
				return [
					{ fileUri: URI.parse(fileToDiffSecondary) },
					{ fileUri: URI.parse(fileToDiffPrimary) }
				];
			}
		}

		return undefined;
	}
}
