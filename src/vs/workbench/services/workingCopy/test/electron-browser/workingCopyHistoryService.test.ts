/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { NativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { TestNativePathService, TestNativeWindowConfiguration } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import { TestContextService, TestProductService, TestWorkingCopy } from 'vs/workbench/test/common/workbenchTestServices';
import { NullLogService } from 'vs/platform/log/common/log';
import { FileService } from 'vs/platform/files/common/fileService';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { Schemas } from 'vs/base/common/network';
import { flakySuite, getRandomTestPath } from 'vs/base/test/node/testUtils';
import { tmpdir } from 'os';
import { join } from 'vs/base/common/path';
import { Promises } from 'vs/base/node/pfs';
import { URI } from 'vs/base/common/uri';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { TestRemoteAgentService } from 'vs/workbench/services/remote/test/common/testServices';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { IWorkingCopyHistoryEntry, IWorkingCopyHistoryEntryDescriptor, IWorkingCopyHistoryEvent } from 'vs/workbench/services/workingCopy/common/workingCopyHistory';
import { IFileService } from 'vs/platform/files/common/files';
import { UriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentityService';
import { LabelService } from 'vs/workbench/services/label/common/labelService';
import { TestLifecycleService, TestWillShutdownEvent } from 'vs/workbench/test/browser/workbenchTestServices';
import { dirname } from 'path';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { NativeWorkingCopyHistoryService } from 'vs/workbench/services/workingCopy/electron-sandbox/workingCopyHistoryService';
import { joinPath } from 'vs/base/common/resources';

class TestWorkbenchEnvironmentService extends NativeWorkbenchEnvironmentService {

	constructor(private readonly testDir: string) {
		super({ ...TestNativeWindowConfiguration, 'user-data-dir': testDir }, TestProductService);
	}

	override get localHistoryHome() {
		return joinPath(URI.file(this.testDir), 'History');
	}
}

export class TestWorkingCopyHistoryService extends NativeWorkingCopyHistoryService {

	readonly _fileService: IFileService;
	readonly _configurationService: TestConfigurationService;
	readonly _lifecycleService: TestLifecycleService;

	constructor(testDir: string) {
		const environmentService = new TestWorkbenchEnvironmentService(testDir);
		const logService = new NullLogService();
		const fileService = new FileService(logService);

		const diskFileSystemProvider = new DiskFileSystemProvider(logService);
		fileService.registerProvider(Schemas.file, diskFileSystemProvider);

		const remoteAgentService = new TestRemoteAgentService();

		const uriIdentityService = new UriIdentityService(fileService);

		const labelService = new LabelService(environmentService, new TestContextService(), new TestNativePathService());

		const lifecycleService = new TestLifecycleService();

		const configurationService = new TestConfigurationService();

		super(fileService, remoteAgentService, environmentService, uriIdentityService, labelService, lifecycleService, logService, configurationService);

		this._fileService = fileService;
		this._configurationService = configurationService;
		this._lifecycleService = lifecycleService;
	}
}

flakySuite('WorkingCopyHistoryService', () => {

	let testDir: string;
	let historyHome: string;
	let service: TestWorkingCopyHistoryService;

	let testFile1Path: string;
	let testFile2Path: string;
	let testFile3Path: string;

	const testFile1PathContents = 'Hello Foo';
	const testFile2PathContents = [
		'Lorem ipsum ',
		'dolor öäü sit amet ',
		'adipiscing ßß elit',
		'consectetur '
	].join('');
	const testFile3PathContents = 'Hello Bar';

	setup(async () => {
		testDir = getRandomTestPath(tmpdir(), 'vsctests', 'workingcopyhistoryservice');
		historyHome = join(testDir, 'User', 'History');

		service = new TestWorkingCopyHistoryService(testDir);

		await Promises.mkdir(historyHome, { recursive: true });

		testFile1Path = join(testDir, 'foo.txt');
		testFile2Path = join(testDir, 'bar.txt');
		testFile3Path = join(testDir, 'foo-bar.txt');

		await Promises.writeFile(testFile1Path, testFile1PathContents);
		await Promises.writeFile(testFile2Path, testFile2PathContents);
		await Promises.writeFile(testFile3Path, testFile3PathContents);
	});

	let increasingTimestampCounter = 1;

	async function addEntry(descriptor: IWorkingCopyHistoryEntryDescriptor, token: CancellationToken, expectEntryAdded?: boolean): Promise<IWorkingCopyHistoryEntry>;
	async function addEntry(descriptor: IWorkingCopyHistoryEntryDescriptor, token: CancellationToken, expectEntryAdded: false): Promise<IWorkingCopyHistoryEntry | undefined>;
	async function addEntry(descriptor: IWorkingCopyHistoryEntryDescriptor, token: CancellationToken, expectEntryAdded = true): Promise<IWorkingCopyHistoryEntry | undefined> {
		const entry = await service.addEntry({
			...descriptor,
			timestamp: increasingTimestampCounter++ // very important to get tests to not be flaky with stable sort order
		}, token);

		if (expectEntryAdded) {
			assert.ok(entry, 'Unexpected undefined local history entry');
			assert.strictEqual(existsSync(entry.location.fsPath), true, 'Unexpected local history not stored on disk');
		}

		return entry;
	}

	teardown(() => {
		service.dispose();

		return Promises.rm(testDir);
	});

	test('addEntry', async () => {
		let addEvents: IWorkingCopyHistoryEvent[] = [];
		service.onDidAddEntry(e => addEvents.push(e));

		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));
		const workingCopy2 = new TestWorkingCopy(URI.file(testFile2Path));

		// Add Entry works

		const entry1A = await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);
		const entry2A = await addEntry({ resource: workingCopy2.resource, source: 'My Source' }, CancellationToken.None);

		assert.strictEqual(readFileSync(entry1A.location.fsPath).toString(), testFile1PathContents);
		assert.strictEqual(readFileSync(entry2A.location.fsPath).toString(), testFile2PathContents);

		assert.strictEqual(addEvents.length, 2);
		assert.strictEqual(addEvents[0].entry.workingCopy.resource.toString(), workingCopy1.resource.toString());
		assert.strictEqual(addEvents[1].entry.workingCopy.resource.toString(), workingCopy2.resource.toString());
		assert.strictEqual(addEvents[1].entry.source, 'My Source');

		const entry1B = await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);
		const entry2B = await addEntry({ resource: workingCopy2.resource }, CancellationToken.None);

		assert.strictEqual(readFileSync(entry1B.location.fsPath).toString(), testFile1PathContents);
		assert.strictEqual(readFileSync(entry2B.location.fsPath).toString(), testFile2PathContents);

		assert.strictEqual(addEvents.length, 4);
		assert.strictEqual(addEvents[2].entry.workingCopy.resource.toString(), workingCopy1.resource.toString());
		assert.strictEqual(addEvents[3].entry.workingCopy.resource.toString(), workingCopy2.resource.toString());

		// Cancellation works

		const cts = new CancellationTokenSource();
		const entry1CPromise = addEntry({ resource: workingCopy1.resource }, cts.token, false);
		cts.dispose(true);

		const entry1C = await entry1CPromise;
		assert.ok(!entry1C);

		assert.strictEqual(addEvents.length, 4);

		// Invalid working copies are ignored

		const workingCopy3 = new TestWorkingCopy(URI.file(testFile2Path).with({ scheme: 'unsupported' }));
		const entry3A = await addEntry({ resource: workingCopy3.resource }, CancellationToken.None, false);
		assert.ok(!entry3A);

		assert.strictEqual(addEvents.length, 4);
	});

	test('renameEntry', async () => {
		let changeEvents: IWorkingCopyHistoryEvent[] = [];
		service.onDidChangeEntry(e => changeEvents.push(e));

		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));

		const entry = await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);
		await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);
		await addEntry({ resource: workingCopy1.resource, source: 'My Source' }, CancellationToken.None);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 3);

		await service.updateEntry(entry, { source: 'Hello Rename' }, CancellationToken.None);

		assert.strictEqual(changeEvents.length, 1);
		assert.strictEqual(changeEvents[0].entry, entry);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries[0].source, 'Hello Rename');

		// Simulate shutdown
		const event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 3);
		assert.strictEqual(entries[0].source, 'Hello Rename');
	});

	test('removeEntry', async () => {
		let removeEvents: IWorkingCopyHistoryEvent[] = [];
		service.onDidRemoveEntry(e => removeEvents.push(e));

		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));

		await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);
		const entry2 = await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);
		await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);
		await addEntry({ resource: workingCopy1.resource, source: 'My Source' }, CancellationToken.None);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 4);

		let removed = await service.removeEntry(entry2, CancellationToken.None);
		assert.strictEqual(removed, true);

		assert.strictEqual(removeEvents.length, 1);
		assert.strictEqual(removeEvents[0].entry, entry2);

		// Cannot remove same entry again
		removed = await service.removeEntry(entry2, CancellationToken.None);
		assert.strictEqual(removed, false);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 3);

		// Simulate shutdown
		const event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 3);
	});

	test('removeAll', async () => {
		let removed = false;
		service.onDidRemoveAllEntries(() => removed = true);

		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));
		const workingCopy2 = new TestWorkingCopy(URI.file(testFile2Path));

		await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);
		await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);
		await addEntry({ resource: workingCopy2.resource }, CancellationToken.None);
		await addEntry({ resource: workingCopy2.resource, source: 'My Source' }, CancellationToken.None);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 2);
		entries = await service.getEntries(workingCopy2.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 2);

		await service.removeAll(CancellationToken.None);

		assert.strictEqual(removed, true);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 0);
		entries = await service.getEntries(workingCopy2.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 0);

		// Simulate shutdown
		const event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 0);
		entries = await service.getEntries(workingCopy2.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 0);
	});

	test('getEntries - simple', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));
		const workingCopy2 = new TestWorkingCopy(URI.file(testFile2Path));

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 0);

		const entry1 = await addEntry({ resource: workingCopy1.resource, source: 'test-source' }, CancellationToken.None);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 1);
		assertEntryEqual(entries[0], entry1);

		const entry2 = await addEntry({ resource: workingCopy1.resource, source: 'test-source' }, CancellationToken.None);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 2);
		assertEntryEqual(entries[1], entry2);

		entries = await service.getEntries(workingCopy2.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 0);

		const entry3 = await addEntry({ resource: workingCopy2.resource, source: 'other-test-source' }, CancellationToken.None);

		entries = await service.getEntries(workingCopy2.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 1);
		assertEntryEqual(entries[0], entry3);
	});

	test('getEntries - metadata preserved when stored', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));
		const workingCopy2 = new TestWorkingCopy(URI.file(testFile2Path));

		const entry1 = await addEntry({ resource: workingCopy1.resource, source: 'test-source' }, CancellationToken.None);
		const entry2 = await addEntry({ resource: workingCopy2.resource }, CancellationToken.None);
		const entry3 = await addEntry({ resource: workingCopy2.resource, source: 'other-source' }, CancellationToken.None);

		// Simulate shutdown
		const event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 1);
		assertEntryEqual(entries[0], entry1);

		entries = await service.getEntries(workingCopy2.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 2);
		assertEntryEqual(entries[0], entry2);
		assertEntryEqual(entries[1], entry3);
	});

	test('getEntries - corrupt meta.json is no problem', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));

		const entry1 = await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);

		// Simulate shutdown
		const event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		const metaFile = join(dirname(entry1.location.fsPath), 'entries.json');
		assert.ok(existsSync(metaFile));
		unlinkSync(metaFile);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 1);
		assertEntryEqual(entries[0], entry1, false /* skip timestamp that is unreliable when entries.json is gone */);
	});

	test('getEntries - missing entries from meta.json is no problem', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));

		const entry1 = await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);
		const entry2 = await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);

		// Simulate shutdown
		const event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		unlinkSync(entry1.location.fsPath);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 1);
		assertEntryEqual(entries[0], entry2);
	});

	test('getEntries - in-memory and on-disk entries are merged', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));

		const entry1 = await addEntry({ resource: workingCopy1.resource, source: 'test-source' }, CancellationToken.None);
		const entry2 = await addEntry({ resource: workingCopy1.resource, source: 'other-source' }, CancellationToken.None);

		// Simulate shutdown
		const event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		const entry3 = await addEntry({ resource: workingCopy1.resource, source: 'test-source' }, CancellationToken.None);
		const entry4 = await addEntry({ resource: workingCopy1.resource, source: 'other-source' }, CancellationToken.None);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 4);
		assertEntryEqual(entries[0], entry1);
		assertEntryEqual(entries[1], entry2);
		assertEntryEqual(entries[2], entry3);
		assertEntryEqual(entries[3], entry4);
	});

	test('getEntries - configured max entries respected', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));

		await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);
		await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);
		const entry3 = await addEntry({ resource: workingCopy1.resource, source: 'Test source' }, CancellationToken.None);
		const entry4 = await addEntry({ resource: workingCopy1.resource }, CancellationToken.None);

		service._configurationService.setUserConfiguration('workbench.localHistory.maxFileEntries', 2);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 2);
		assertEntryEqual(entries[0], entry3);
		assertEntryEqual(entries[1], entry4);

		service._configurationService.setUserConfiguration('workbench.localHistory.maxFileEntries', 4);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 4);

		service._configurationService.setUserConfiguration('workbench.localHistory.maxFileEntries', 5);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 4);
	});

	test('getAll', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));
		const workingCopy2 = new TestWorkingCopy(URI.file(testFile2Path));

		let resources = await service.getAll(CancellationToken.None);
		assert.strictEqual(resources.length, 0);

		await addEntry({ resource: workingCopy1.resource, source: 'test-source' }, CancellationToken.None);
		await addEntry({ resource: workingCopy1.resource, source: 'test-source' }, CancellationToken.None);
		await addEntry({ resource: workingCopy2.resource, source: 'test-source' }, CancellationToken.None);
		await addEntry({ resource: workingCopy2.resource, source: 'test-source' }, CancellationToken.None);

		resources = await service.getAll(CancellationToken.None);
		assert.strictEqual(resources.length, 2);
		for (const resource of resources) {
			if (resource.toString() !== workingCopy1.resource.toString() && resource.toString() !== workingCopy2.resource.toString()) {
				assert.fail(`Unexpected history resource: ${resource.toString()}`);
			}
		}

		// Simulate shutdown
		const event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		const workingCopy3 = new TestWorkingCopy(URI.file(testFile3Path));
		await addEntry({ resource: workingCopy3.resource, source: 'test-source' }, CancellationToken.None);

		resources = await service.getAll(CancellationToken.None);
		assert.strictEqual(resources.length, 3);
		for (const resource of resources) {
			if (resource.toString() !== workingCopy1.resource.toString() && resource.toString() !== workingCopy2.resource.toString() && resource.toString() !== workingCopy3.resource.toString()) {
				assert.fail(`Unexpected history resource: ${resource.toString()}`);
			}
		}
	});

	function assertEntryEqual(entryA: IWorkingCopyHistoryEntry, entryB: IWorkingCopyHistoryEntry, assertTimestamp = true): void {
		assert.strictEqual(entryA.id, entryB.id);
		assert.strictEqual(entryA.location.toString(), entryB.location.toString());
		if (assertTimestamp) {
			assert.strictEqual(entryA.timestamp, entryB.timestamp);
		}
		assert.strictEqual(entryA.source, entryB.source);
		assert.strictEqual(entryA.workingCopy.name, entryB.workingCopy.name);
		assert.strictEqual(entryA.workingCopy.resource.toString(), entryB.workingCopy.resource.toString());
	}

	test('entries cleaned up on shutdown', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));

		const entry1 = await addEntry({ resource: workingCopy1.resource, source: 'test-source' }, CancellationToken.None);
		const entry2 = await addEntry({ resource: workingCopy1.resource, source: 'other-source' }, CancellationToken.None);
		const entry3 = await addEntry({ resource: workingCopy1.resource, source: 'other-source' }, CancellationToken.None);
		const entry4 = await addEntry({ resource: workingCopy1.resource, source: 'other-source' }, CancellationToken.None);

		service._configurationService.setUserConfiguration('workbench.localHistory.maxFileEntries', 2);

		// Simulate shutdown
		let event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		assert.ok(!existsSync(entry1.location.fsPath));
		assert.ok(!existsSync(entry2.location.fsPath));
		assert.ok(existsSync(entry3.location.fsPath));
		assert.ok(existsSync(entry4.location.fsPath));

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 2);
		assertEntryEqual(entries[0], entry3);
		assertEntryEqual(entries[1], entry4);

		service._configurationService.setUserConfiguration('workbench.localHistory.maxFileEntries', 3);

		const entry5 = await addEntry({ resource: workingCopy1.resource, source: 'other-source' }, CancellationToken.None);

		// Simulate shutdown
		event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		assert.ok(existsSync(entry3.location.fsPath));
		assert.ok(existsSync(entry4.location.fsPath));
		assert.ok(existsSync(entry5.location.fsPath));

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 3);
		assertEntryEqual(entries[0], entry3);
		assertEntryEqual(entries[1], entry4);
		assertEntryEqual(entries[2], entry5);
	});
});
