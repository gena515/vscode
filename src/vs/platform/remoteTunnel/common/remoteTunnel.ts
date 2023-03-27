/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { localize } from 'vs/nls';

export interface IRemoteTunnelAccount {
	readonly providerId: string;
	readonly token: string;
	readonly sessionId: string;
	readonly accountLabel: string;
}

export const IRemoteTunnelService = createDecorator<IRemoteTunnelService>('IRemoteTunnelService');
export interface IRemoteTunnelService {
	readonly _serviceBrand: undefined;

	readonly onDidTokenFailed: Event<IRemoteTunnelAccount | undefined>;

	readonly onDidChangeTunnelStatus: Event<TunnelStatus>;
	getTunnelStatus(): Promise<TunnelStatus>;

	getAccount(): Promise<IRemoteTunnelAccount | undefined>;
	readonly onDidChangeAccount: Event<IRemoteTunnelAccount | undefined>;
	updateAccount(account: IRemoteTunnelAccount | undefined): Promise<TunnelStatus>;
	stopTunnel(): Promise<void>;
	getHostName(): Promise<string | undefined>;

}

export type TunnelStatus = TunnelStates.Connected | TunnelStates.Disconnected | TunnelStates.Connecting | TunnelStates.Uninitialized;

export namespace TunnelStates {
	export interface Uninitialized {
		readonly type: 'uninitialized';
	}
	export interface Connecting {
		readonly type: 'connecting';
		readonly progress?: string;
	}
	export interface Connected {
		readonly type: 'connected';
		readonly info: ConnectionInfo;
	}
	export interface Disconnected {
		readonly type: 'disconnected';
		readonly onTokenFailed?: IRemoteTunnelAccount;
	}
	export const disconnected = (onTokenFailed?: IRemoteTunnelAccount): Disconnected => ({ type: 'disconnected', onTokenFailed });
	export const connected = (info: ConnectionInfo): Connected => ({ type: 'connected', info });
	export const connecting = (progress?: string): Connecting => ({ type: 'connecting', progress });

}

export interface ConnectionInfo {
	link: string;
	domain: string;
	hostName: string;
	isAttached: boolean;
}

export const CONFIGURATION_KEY_PREFIX = 'remote.tunnels.access';
export const CONFIGURATION_KEY_HOST_NAME = CONFIGURATION_KEY_PREFIX + '.hostNameOverride';
export const CONFIGURATION_KEY_PREVENT_SLEEP = CONFIGURATION_KEY_PREFIX + '.preventSleep';

export const LOG_ID = 'remoteTunnelService';
export const LOGGER_NAME = localize('remoteTunnelLog', "Remote Tunnel Service");
