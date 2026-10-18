import { inspect } from 'node:util';
import { ConfigError, validateConfig } from '@directory/config';
import type { DirectoryConfiguration } from '@directory/config/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootApp } from './boot.js';
import { DirectoryError, type Directory } from './config/load-directory.js';
import { prepareSnapshot } from './config/snapshot.js';
import { reportDirectoryIssue } from './logger.js';

const mocks = vi.hoisted(() => ({
	path: vi.fn<typeof import('@directory/config').resolveConfigPath>(),
	load: vi.fn<typeof import('@directory/config').loadConfigFile>(),
	directory: vi.fn<typeof import('./config/load-directory.js').loadDirectory>(),
	watch: vi.fn<typeof import('./config/watch.js').watchConfig>(),
	stopWatching: vi.fn<() => void>()
}));

vi.mock('@directory/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@directory/config')>()),
	resolveConfigPath: mocks.path,
	loadConfigFile: mocks.load
}));
vi.mock('./config/load-directory.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./config/load-directory.js')>()),
	loadDirectory: mocks.directory
}));
vi.mock('./config/watch.js', () => ({ watchConfig: mocks.watch }));

const realDirectory = await vi.importActual<typeof import('./config/load-directory.js')>(
	'./config/load-directory.js'
);
const sentinel = 'PRIVATE-environment-password-filename.yaml';

function configuration(auth?: DirectoryConfiguration['auth']): DirectoryConfiguration {
	const input: Record<string, unknown> = {
		site: { title: 'Family', description: 'Welcome' },
		links: { photos: { title: 'Photos', url: 'https://photos.example.com' } }
	};
	if (auth !== undefined) input.auth = auth;
	return validateConfig(input, { env: {} });
}

function loadedDirectory(config = configuration()) {
	return {
		currentSnapshot: vi.fn().mockReturnValue(prepareSnapshot(config)),
		reload: vi.fn<Directory['reload']>().mockResolvedValue(undefined),
		stop: vi.fn<Directory['stop']>()
	};
}

function expectRedacted(error: unknown): void {
	for (const text of [String(error), inspect(error), JSON.stringify(error)]) {
		expect(text).not.toContain(sentinel);
	}
	if (error instanceof Error) expect(error.stack).not.toContain(sentinel);
	expect(error).not.toHaveProperty('cause');
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.path.mockReset().mockReturnValue(`/config/${sentinel}`);
	mocks.load.mockReset().mockResolvedValue(configuration());
	mocks.directory.mockReset().mockResolvedValue(loadedDirectory());
	mocks.watch.mockReset().mockReturnValue(mocks.stopWatching);
});

describe('bootApp', () => {
	it('waits for valid startup, pins one path for loading and watching, then closes the save gap', async () => {
		const pending = Promise.withResolvers<Directory>();
		const directory = loadedDirectory();
		mocks.directory.mockReturnValueOnce(pending.promise);
		const env = { CONFIG_PATH: `/config/${sentinel}`, SECRET: sentinel };
		const boot = bootApp(env);
		expect(mocks.path).toHaveBeenCalledExactlyOnceWith({ env });
		expect(mocks.directory).toHaveBeenCalledExactlyOnceWith(`/config/${sentinel}`, {
			env,
			report: reportDirectoryIssue
		});
		expect(mocks.watch).not.toHaveBeenCalled();
		env.CONFIG_PATH = '/config/changed.yaml';
		pending.resolve(directory);
		const app = await boot;
		expect(mocks.path).toHaveBeenCalledTimes(1);
		expect(directory.currentSnapshot).toHaveBeenCalledTimes(1);
		expect(mocks.watch).toHaveBeenCalledExactlyOnceWith(
			`/config/${sentinel}`,
			expect.any(Function)
		);
		expect(mocks.watch.mock.invocationCallOrder[0]).toBeLessThan(
			directory.reload.mock.invocationCallOrder[0]!
		);
		expect(directory.reload).toHaveBeenCalledTimes(1);
		expect(app.currentSnapshot()).toBe(directory.currentSnapshot.mock.results[0]?.value);
		await mocks.watch.mock.calls[0]![1]();
		await app.reload();
		expect(directory.reload).toHaveBeenCalledTimes(3);
		app.stop();
		expect(mocks.stopWatching).toHaveBeenCalledOnce();
		expect(directory.stop).toHaveBeenCalledOnce();
	});

	it('does not resolve boot until the post-watch reload finishes', async () => {
		const pending = Promise.withResolvers<void>();
		const reloading = Promise.withResolvers<void>();
		const directory = loadedDirectory();
		directory.reload.mockImplementationOnce(() => {
			reloading.resolve();
			return pending.promise;
		});
		mocks.directory.mockResolvedValueOnce(directory);
		let ready = false;
		const boot = bootApp().then((app) => {
			ready = true;
			return app;
		});
		await reloading.promise;
		expect(directory.reload).toHaveBeenCalledOnce();
		expect(ready).toBe(false);
		pending.resolve();
		const app = await boot;
		expect(ready).toBe(true);
		app.stop();
	});

	it('propagates redacted invalid startup without starting a watcher', async () => {
		const error = new DirectoryError({
			code: 'load_failed',
			issues: new ConfigError([{ code: 'missing_environment', path: `/links/${sentinel}/url` }])
				.issues
		});
		mocks.directory.mockRejectedValueOnce(error);
		await expect(bootApp()).rejects.toBe(error);
		expectRedacted(error);
		expect(mocks.watch).not.toHaveBeenCalled();
	});

	it('redacts unknown startup errors', async () => {
		mocks.directory.mockRejectedValueOnce(new Error(sentinel));
		const error: unknown = await bootApp().catch((error: unknown) => error);
		expect(error).toBeInstanceOf(DirectoryError);
		expect((error as DirectoryError).issue).toEqual({ code: 'load_failed' });
		expectRedacted(error);
		expect(mocks.watch).not.toHaveBeenCalled();
	});

	it('redacts path resolution errors before loading or watching', async () => {
		mocks.path.mockImplementationOnce(() => {
			throw new Error(sentinel);
		});
		const error: unknown = await bootApp().catch((error: unknown) => error);
		expect(error).toBeInstanceOf(DirectoryError);
		expectRedacted(error);
		expect(mocks.directory).not.toHaveBeenCalled();
		expect(mocks.watch).not.toHaveBeenCalled();
	});

	it.each([
		{ credentials: { username: sentinel, password: sentinel } },
		{
			oidc: {
				issuer: 'https://identity.example.com',
				client_id: sentinel,
				client_secret: sentinel
			}
		}
	])('rejects an enabled auth strategy before watching or reloading', async (auth) => {
		const directory = loadedDirectory(configuration(auth));
		mocks.directory.mockResolvedValueOnce(directory);
		const error: unknown = await bootApp().catch((error: unknown) => error);
		expect(error).toBeInstanceOf(DirectoryError);
		expect((error as DirectoryError).issue).toEqual({ code: 'auth_unavailable' });
		expectRedacted(error);
		expect(directory.stop).toHaveBeenCalledOnce();
		expect(directory.reload).not.toHaveBeenCalled();
		expect(mocks.watch).not.toHaveBeenCalled();
	});

	it('stops the loaded directory and redacts a watcher setup failure', async () => {
		const directory = loadedDirectory();
		mocks.directory.mockResolvedValueOnce(directory);
		mocks.watch.mockImplementationOnce(() => {
			throw new Error(sentinel);
		});
		const error: unknown = await bootApp().catch((error: unknown) => error);
		expect(error).toBeInstanceOf(DirectoryError);
		expect((error as DirectoryError).issue).toEqual({ code: 'watch_failed' });
		expectRedacted(error);
		expect(directory.stop).toHaveBeenCalledOnce();
		expect(directory.reload).not.toHaveBeenCalled();
	});

	it('stops watching and prevents a pending real directory reload from publishing', async () => {
		mocks.directory.mockImplementationOnce(realDirectory.loadDirectory);
		const app = await bootApp({});
		const original = app.currentSnapshot();
		const pending = Promise.withResolvers<DirectoryConfiguration>();
		const loading = Promise.withResolvers<void>();
		mocks.load.mockImplementationOnce(() => {
			loading.resolve();
			return pending.promise;
		});
		const reload = mocks.watch.mock.calls[0]![1]();
		await loading.promise;
		app.stop();
		pending.resolve(validateConfig({ site: { title: 'Replacement' }, links: {} }, { env: {} }));
		await reload;
		expect(mocks.stopWatching).toHaveBeenCalledOnce();
		expect(app.currentSnapshot()).toBe(original);
		expect(original.display.site.title).toBe('Family');
		await app.reload();
		expect(mocks.load).toHaveBeenCalledTimes(3);
	});
});
