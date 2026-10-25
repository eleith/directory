import { inspect } from 'node:util';
import { resolve } from 'node:path';
import { ConfigError, validateConfig } from '@directory/config';
import type { DirectoryConfiguration } from '@directory/config/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Authentication } from './auth/index.js';
import { AuthSettingsError } from './auth/settings.js';
import { bootApp } from './boot.js';
import type { Directory } from './config/load-directory.js';
import { DirectoryError } from './directory-error.js';
import { prepareSnapshot } from './config/snapshot.js';
import { logger, reportDirectoryIssue, reportStartupFailure } from './logger.js';

const mocks = vi.hoisted(() => ({
	auth: vi.fn<typeof import('./auth/index.js').createAuthentication>(),
	path: vi.fn<typeof import('@directory/config').resolveConfigPath>(),
	publicDir: vi.fn<typeof import('@directory/config').resolvePublicDir>(),
	load: vi.fn<typeof import('@directory/config').loadConfigFile>(),
	directory: vi.fn<typeof import('./config/load-directory.js').loadDirectory>(),
	watch: vi.fn<typeof import('./config/watch.js').watchConfig>(),
	stopWatching: vi.fn<() => void>()
}));

vi.mock('@directory/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@directory/config')>()),
	resolveConfigPath: mocks.path,
	resolvePublicDir: mocks.publicDir,
	loadConfigFile: mocks.load
}));
vi.mock('./config/load-directory.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./config/load-directory.js')>()),
	loadDirectory: mocks.directory
}));
vi.mock('./config/watch.js', () => ({ watchConfig: mocks.watch }));
vi.mock('./auth/index.js', () => ({ createAuthentication: mocks.auth }));

const realDirectory = await vi.importActual<typeof import('./config/load-directory.js')>(
	'./config/load-directory.js'
);
const realConfig = await vi.importActual<typeof import('@directory/config')>('@directory/config');
const sentinel = 'PRIVATE-environment-password-filename.yaml';
const authCases = [
	{ strategy: 'credentials', auth: { credentials: { username: sentinel, password: sentinel } } },
	{
		strategy: 'oidc',
		auth: {
			oidc: {
				issuer: 'https://identity.example.com',
				client_id: sentinel,
				client_secret: sentinel
			}
		}
	}
] satisfies { strategy: Authentication['strategy']; auth: DirectoryConfiguration['auth'] }[];

function authentication(strategy: Authentication['strategy']): Authentication {
	return {
		strategy,
		handle: vi.fn<Authentication['handle']>().mockResolvedValue(new Response()),
		signIn: vi.fn<Authentication['signIn']>().mockResolvedValue(undefined),
		signOut: vi.fn<Authentication['signOut']>().mockResolvedValue(undefined)
	};
}

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
	mocks.auth.mockReset();
	mocks.path.mockReset().mockReturnValue(`/config/${sentinel}`);
	mocks.publicDir.mockReset().mockReturnValue('/mounted/public');
	mocks.load.mockReset().mockResolvedValue(configuration());
	mocks.directory.mockReset().mockResolvedValue(loadedDirectory());
	mocks.watch.mockReset().mockReturnValue(mocks.stopWatching);
});

describe('bootApp', () => {
	it('waits for valid startup, pins one path for loading and watching, then closes the save gap', async () => {
		const pending = Promise.withResolvers<Directory>();
		const directory = loadedDirectory();
		mocks.directory.mockReturnValueOnce(pending.promise);
		const env = {
			CONFIG_PATH: `/config/${sentinel}`,
			DIRECTORY_PUBLIC_DIR: '/mounted/public',
			SECRET: sentinel
		};
		const boot = bootApp(env);
		expect(mocks.path).toHaveBeenCalledExactlyOnceWith({ env });
		expect(mocks.publicDir).toHaveBeenCalledExactlyOnceWith(`/config/${sentinel}`, { env });
		expect(mocks.directory).toHaveBeenCalledExactlyOnceWith(`/config/${sentinel}`, {
			env,
			report: reportDirectoryIssue
		});
		expect(mocks.watch).not.toHaveBeenCalled();
		env.CONFIG_PATH = '/config/changed.yaml';
		env.DIRECTORY_PUBLIC_DIR = '/mounted/changed';
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
		expect(app.directory).toBe(directory);
		expect(app.publicDir).toBe('/mounted/public');
		expect(mocks.publicDir).toHaveBeenCalledTimes(1);
		expect(app.authentication).toBeUndefined();
		expect(mocks.auth).not.toHaveBeenCalled();
		expect(app.directory.currentSnapshot()).toBe(directory.currentSnapshot.mock.results[0]?.value);
		await mocks.watch.mock.calls[0]![1]();
		await app.directory.reload();
		expect(directory.reload).toHaveBeenCalledTimes(3);
		app.stop();
		expect(mocks.stopWatching).toHaveBeenCalledOnce();
		expect(directory.stop).toHaveBeenCalledOnce();
	});

	it.each([
		[{}, '/deployment/public'],
		[{ DIRECTORY_PUBLIC_DIR: 'mounted/images' }, resolve('mounted/images')],
		[{ DIRECTORY_PUBLIC_DIR: '/mounted/images' }, '/mounted/images']
	])(
		'pins the resolved public directory without requiring it to exist: %j',
		async (env, expected) => {
			mocks.path.mockReturnValue('/deployment/config/directory.yaml');
			mocks.publicDir.mockImplementation(realConfig.resolvePublicDir);
			const app = await bootApp(env);
			expect(app.publicDir).toBe(expected);
			expect(mocks.publicDir).toHaveBeenCalledExactlyOnceWith('/deployment/config/directory.yaml', {
				env
			});
			app.stop();
		}
	);

	it('passes the same default options to both path resolvers', async () => {
		const app = await bootApp();
		expect(mocks.path).toHaveBeenCalledExactlyOnceWith({});
		expect(mocks.publicDir).toHaveBeenCalledExactlyOnceWith(`/config/${sentinel}`, {});
		app.stop();
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

	it('redacts public directory resolution errors before loading or watching', async () => {
		mocks.publicDir.mockImplementationOnce(() => {
			throw new Error(sentinel);
		});
		const error: unknown = await bootApp({}).catch((error: unknown) => error);
		expect(error).toBeInstanceOf(DirectoryError);
		expect((error as DirectoryError).issue).toEqual({ code: 'load_failed' });
		expectRedacted(error);
		expect(mocks.directory).not.toHaveBeenCalled();
		expect(mocks.watch).not.toHaveBeenCalled();
	});

	it.each(authCases)(
		'creates $strategy authentication once before watching, retaining it across the post-watch reload',
		async ({ strategy, auth }) => {
			const config = configuration(auth);
			const replacement = validateConfig(
				{ ...config, site: { ...config.site, title: 'Replacement' } },
				{ env: {} }
			);
			const ready = authentication(strategy);
			const env = {
				AUTH_SECRET: sentinel.repeat(2),
				ORIGIN: 'https://directory.example.com',
				AUTH_URL: 'https://directory.example.com'
			};
			mocks.load.mockResolvedValueOnce(config).mockResolvedValue(replacement);
			mocks.directory.mockImplementationOnce(realDirectory.loadDirectory);
			mocks.auth.mockImplementationOnce((input) => {
				expect(input).toEqual(config.auth);
				expect(input).not.toBe(config.auth);
				expect(Object.isFrozen(input)).toBe(true);
				expect(Object.isFrozen('credentials' in input ? input.credentials : input.oidc)).toBe(true);
				expect(mocks.watch).not.toHaveBeenCalled();
				return ready;
			});
			const app = await bootApp(env);
			expect(mocks.auth).toHaveBeenCalledExactlyOnceWith(expect.any(Object), env);
			expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(
				mocks.watch.mock.invocationCallOrder[0]!
			);
			expect(mocks.load).toHaveBeenCalledTimes(2);
			expect(app.directory.currentSnapshot().display.site.title).toBe('Replacement');
			expect(app.authentication).toBe(ready);
			await app.directory.reload();
			expect(app.authentication).toBe(ready);
			expect(mocks.auth).toHaveBeenCalledOnce();
			app.stop();
			expect(mocks.stopWatching).toHaveBeenCalledOnce();
		}
	);

	it('preserves a known auth settings error for reporting after stopping the directory', async () => {
		const directory = loadedDirectory(configuration(authCases[0]!.auth));
		const failure = new AuthSettingsError('AUTH_SECRET');
		mocks.directory.mockResolvedValueOnce(directory);
		mocks.auth.mockImplementationOnce(() => {
			throw failure;
		});
		const output = vi.spyOn(logger, 'error').mockReturnValue(undefined);
		try {
			const error: unknown = await bootApp({}).catch((error: unknown) => error);
			expect(error).toBe(failure);
			expectRedacted(error);
			expect(directory.stop).toHaveBeenCalledOnce();
			expect(directory.reload).not.toHaveBeenCalled();
			expect(mocks.watch).not.toHaveBeenCalled();
			reportStartupFailure(error);
			expect(output.mock.calls).toEqual([
				['Application startup failed (auth_failed).'],
				[
					'Invalid authentication configuration: AUTH_SECRET is required when authentication is enabled and must contain at least 32 characters.'
				]
			]);
		} finally {
			output.mockRestore();
		}
	});

	it.each(authCases)(
		'redacts unknown $strategy provider initialization failures before watching or reloading',
		async ({ auth }) => {
			const directory = loadedDirectory(configuration(auth));
			mocks.directory.mockResolvedValueOnce(directory);
			mocks.auth.mockImplementationOnce(() => {
				throw new Error(sentinel, { cause: sentinel });
			});
			const env = { ORIGIN: 'https://directory.example.com' };
			const error: unknown = await bootApp(env).catch((error: unknown) => error);
			expect(mocks.auth).toHaveBeenCalledExactlyOnceWith(
				directory.currentSnapshot.mock.results[0]?.value.configuration.auth,
				env
			);
			expect(error).toBeInstanceOf(DirectoryError);
			expect((error as DirectoryError).issue).toEqual({ code: 'auth_failed' });
			expectRedacted(error);
			const output = vi.spyOn(logger, 'error').mockReturnValue(undefined);
			try {
				reportStartupFailure(error);
				expect(output).toHaveBeenCalledExactlyOnceWith('Application startup failed (auth_failed).');
			} finally {
				output.mockRestore();
			}
			expect(directory.stop).toHaveBeenCalledOnce();
			expect(directory.reload).not.toHaveBeenCalled();
			expect(mocks.watch).not.toHaveBeenCalled();
		}
	);

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
		expect(app.authentication).toBeUndefined();
		expect(mocks.auth).not.toHaveBeenCalled();
		const original = app.directory.currentSnapshot();
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
		expect(app.directory.currentSnapshot()).toBe(original);
		expect(original.display.site.title).toBe('Family');
		await app.directory.reload();
		expect(mocks.load).toHaveBeenCalledTimes(3);
	});
});
