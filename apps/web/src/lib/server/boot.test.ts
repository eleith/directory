import { ConfigError, validateConfig } from '@directory/config';
import type { DirectoryConfiguration } from '@directory/config/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportConfigError } from './logger.js';
import type { Authentication } from './auth/index.js';
import { bootApp } from './boot.js';
import { DirectoryError } from './directory-error.js';

const mocks = vi.hoisted(() => ({
	path: vi.fn<typeof import('@directory/config').resolveConfigPath>(),
	publicDir: vi.fn<typeof import('@directory/config').resolvePublicDir>(),
	load: vi.fn<typeof import('@directory/config').loadConfigFile>(),
	monitor: vi.fn<typeof import('@directory/config').startConfigReloading>(),
	auth: vi.fn<typeof import('./auth/index.js').createAuthentication>(),
	stop: vi.fn<() => void>()
}));
vi.mock('@directory/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@directory/config')>()),
	resolveConfigPath: mocks.path,
	resolvePublicDir: mocks.publicDir,
	loadConfigFile: mocks.load,
	startConfigReloading: mocks.monitor
}));
vi.mock('./auth/index.js', () => ({ createAuthentication: mocks.auth }));

const path = '/config/directory.yaml';
const sentinel = 'PRIVATE-config-credential';
const origin = 'https://directory.example.com';
const frameworkEnv = { ORIGIN: origin };
const auth = { credentials: { username: 'family', password: sentinel } };
const authentication: Authentication = {
	strategy: 'credentials',
	handle: vi.fn(),
	signIn: vi.fn(),
	signOut: vi.fn()
};

function configuration(title = 'Home', enabled = false): DirectoryConfiguration {
	return validateConfig({ site: { url: origin, title }, links: {}, ...(enabled ? { auth } : {}) });
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv('ORIGIN', origin);
	mocks.path.mockReturnValue(path);
	mocks.publicDir.mockReturnValue('/mounted/public');
	mocks.load.mockResolvedValue(configuration());
	mocks.monitor.mockResolvedValue(mocks.stop);
	mocks.auth.mockReturnValue(authentication);
});
afterEach(() => vi.unstubAllEnvs());

describe('application boot wiring', () => {
	it('resolves paths once and connects the loader, application reaction and diagnostics', async () => {
		const initial = configuration();
		const pending = Promise.withResolvers<DirectoryConfiguration>();
		mocks.load.mockReturnValueOnce(pending.promise);
		const env = { CONFIG_PATH: path, DIRECTORY_PUBLIC_DIR: '/mounted/public' };
		const startup = bootApp(env);
		expect(mocks.path).toHaveBeenCalledExactlyOnceWith({ env });
		expect(mocks.publicDir).toHaveBeenCalledExactlyOnceWith(path, { env });
		expect(mocks.load).toHaveBeenCalledExactlyOnceWith(path, { env });
		expect(mocks.monitor).not.toHaveBeenCalled();

		env.CONFIG_PATH = '/config/changed.yaml';
		env.DIRECTORY_PUBLIC_DIR = '/mounted/changed';
		pending.resolve(initial);
		const app = await startup;
		expect(mocks.monitor).toHaveBeenCalledExactlyOnceWith({
			path,
			initial,
			load: expect.any(Function),
			onChange: app.onConfigChange,
			onError: reportConfigError
		});
		expect(app.publicDir).toBe('/mounted/public');
		expect(app.currentSnapshot().display.site.title).toBe('Home');
		expect(mocks.path).toHaveBeenCalledOnce();
		expect(mocks.publicDir).toHaveBeenCalledOnce();

		const options = mocks.monitor.mock.calls[0]![0];
		mocks.load.mockResolvedValueOnce(configuration('Updated'));
		const next = await options.load(options.path);
		expect(mocks.load).toHaveBeenLastCalledWith(path, { env });
		expect(options.onChange(next, options.initial)).toBe(true);
		expect(app.currentSnapshot().display.site.title).toBe('Updated');
		expect(app.stop).toBe(mocks.stop);
		app.stop();
		expect(mocks.stop).toHaveBeenCalledOnce();
	});

	it('waits for monitor reconciliation before returning the application', async () => {
		const entered = Promise.withResolvers<void>();
		const pending = Promise.withResolvers<() => void>();
		mocks.monitor.mockImplementationOnce(() => {
			entered.resolve();
			return pending.promise;
		});
		const ready = vi.fn();
		const startup = bootApp().then(ready);
		await entered.promise;
		expect(ready).not.toHaveBeenCalled();
		pending.resolve(mocks.stop);
		await startup;
		expect(ready).toHaveBeenCalledOnce();
	});

	it('constructs auth before monitoring from the prepared origin, not legacy auth settings', async () => {
		vi.stubEnv('ORIGIN', origin);
		vi.stubEnv('AUTH_URL', 'https://not-kit.example.com');
		mocks.load.mockResolvedValueOnce(configuration('Home', true));
		const env = { ORIGIN: sentinel, AUTH_URL: sentinel };
		const app = await bootApp(env, frameworkEnv);
		expect(mocks.load).toHaveBeenCalledExactlyOnceWith(path, { env });
		expect(mocks.auth).toHaveBeenCalledExactlyOnceWith({ ...auth, origin });
		expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.monitor.mock.invocationCallOrder[0]!
		);
		expect(app.authentication).toBe(authentication);
	});

	describe.each([false, true])('canonical URL consistency (auth enabled: %s)', (enabled) => {
		it('boots with the prepared canonical URL regardless of auth state', async () => {
			mocks.load.mockResolvedValueOnce(configuration('Home', enabled));
			const app = await bootApp({}, frameworkEnv);
			expect(app.currentSnapshot().configuration.site.url).toBe(origin);
			expect(app.authentication).toBe(enabled ? authentication : undefined);
		});

		it.each([
			{ name: 'process ORIGIN missing', prepared: undefined, privateEnv: frameworkEnv },
			{ name: 'process ORIGIN empty', prepared: '', privateEnv: frameworkEnv },
			{
				name: 'prepared process origin changed',
				prepared: 'https://other.example.com',
				privateEnv: frameworkEnv
			},
			{ name: 'Kit private URLs missing', prepared: origin, privateEnv: {} },
			{
				name: 'Kit private ORIGIN differs',
				prepared: origin,
				privateEnv: { ...frameworkEnv, ORIGIN: sentinel }
			},
			{
				name: 'site.url changed after preparation',
				prepared: origin,
				privateEnv: frameworkEnv,
				url: 'https://other.example.com'
			}
		])(
			'fails closed when $name before auth or monitoring',
			async ({ prepared, privateEnv, ...change }) => {
				vi.stubEnv('ORIGIN', prepared);
				const config = configuration('Home', enabled);
				if ('url' in change && change.url) config.site.url = change.url;
				mocks.load.mockResolvedValueOnce(config);
				await expect(bootApp({}, privateEnv)).rejects.toMatchObject({
					issue: { code: 'auth_failed' }
				});
				expect(mocks.auth).not.toHaveBeenCalled();
				expect(mocks.monitor).not.toHaveBeenCalled();
			}
		);
	});

	it('uses the process environment when no environments are injected', async () => {
		await bootApp();
		expect(mocks.path).toHaveBeenCalledExactlyOnceWith({ env: process.env });
		expect(mocks.load).toHaveBeenCalledExactlyOnceWith(path, { env: process.env });
	});

	it('retains safe loader diagnostics without starting monitoring', async () => {
		const failure = new ConfigError([
			{ code: 'missing_environment', path: `/links/${sentinel}/url` }
		]);
		mocks.load.mockRejectedValueOnce(failure);
		const error: unknown = await bootApp().catch((error: unknown) => error);
		expect(error).toBeInstanceOf(DirectoryError);
		expect(error).toMatchObject({ issue: { code: 'load_failed', issues: failure.issues } });
		expect(JSON.stringify(error)).not.toContain(sentinel);
		expect(mocks.monitor).not.toHaveBeenCalled();
	});

	it.each(['path', 'publicDir', 'load'] as const)(
		'redacts unexpected %s failures',
		async (stage) => {
			mocks[stage].mockImplementationOnce(() => {
				throw new Error(sentinel);
			});
			const error: unknown = await bootApp().catch((error: unknown) => error);
			expect(error).toMatchObject({ issue: { code: 'load_failed' } });
			expect(String(error)).not.toContain(sentinel);
			expect(error).not.toHaveProperty('cause');
			expect(mocks.monitor).not.toHaveBeenCalled();
		}
	);

	it('does not start monitoring when authentication initialization fails', async () => {
		vi.stubEnv('ORIGIN', origin);
		mocks.load.mockResolvedValueOnce(configuration('Home', true));
		mocks.auth.mockImplementationOnce(() => {
			throw new Error(sentinel);
		});
		await expect(bootApp({}, frameworkEnv)).rejects.toMatchObject({
			issue: { code: 'auth_failed' }
		});
		expect(mocks.monitor).not.toHaveBeenCalled();
	});

	it('redacts monitor setup errors at the application boundary', async () => {
		mocks.monitor.mockRejectedValueOnce(new Error(sentinel));
		const error: unknown = await bootApp().catch((error: unknown) => error);
		expect(error).toMatchObject({ issue: { code: 'watch_failed' } });
		expect(String(error)).not.toContain(sentinel);
		expect(error).not.toHaveProperty('cause');
	});
});
