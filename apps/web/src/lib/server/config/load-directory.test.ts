import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inspect } from 'node:util';
import { ConfigError, validateConfig } from '@directory/config';
import type { DirectoryConfiguration } from '@directory/config/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectoryError, loadDirectory, type DirectoryIssue } from './load-directory.js';
import type { PreparedSnapshot } from './snapshot.js';

const mocks = vi.hoisted(() => ({
	load: vi.fn<typeof import('@directory/config').loadConfigFile>(),
	prepare: vi.fn<(config: DirectoryConfiguration) => PreparedSnapshot | Promise<PreparedSnapshot>>()
}));

vi.mock('@directory/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@directory/config')>()),
	loadConfigFile: mocks.load
}));
vi.mock('./snapshot.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./snapshot.js')>()),
	prepareSnapshot: mocks.prepare
}));

const realSnapshot = await vi.importActual<typeof import('./snapshot.js')>('./snapshot.js');
const sentinel = 'PRIVATE-password-env-filename.yml';
const credentials = { credentials: { username: 'family', password: sentinel } };
const oidc = {
	oidc: {
		issuer: 'https://identity.example.com',
		client_id: 'directory',
		client_secret: sentinel
	}
};

function configuration(
	title = 'boot',
	auth?: DirectoryConfiguration['auth']
): DirectoryConfiguration {
	return validateConfig(
		{
			site: { title, logo_path: `/public/${title}.svg` },
			...(auth === undefined ? {} : { auth }),
			links: {
				photos: {
					title: `${title} photos`,
					url: 'https://photos.example.com',
					logo_path: `/public/${title}-photos.svg`,
					tags: ' photos, backup '
				}
			}
		},
		{ env: {} }
	);
}

function expectRedacted(value: unknown): void {
	for (const text of [String(value), JSON.stringify(value), inspect(value)]) {
		expect(text).not.toContain(sentinel);
	}
	if (value instanceof Error) expect(value.stack).not.toContain(sentinel);
	expect(value).not.toHaveProperty('cause');
	expect(value).not.toHaveProperty('value');
	expect(value).not.toHaveProperty('path');
}

beforeEach(() => {
	mocks.load.mockReset().mockResolvedValue(configuration());
	mocks.prepare.mockReset().mockImplementation(realSnapshot.prepareSnapshot);
});

describe('directory startup', () => {
	it('returns a directory only after loading and preparation have completed', async () => {
		const loaded = Promise.withResolvers<DirectoryConfiguration>();
		const prepared = Promise.withResolvers<PreparedSnapshot>();
		const preparing = Promise.withResolvers<void>();
		mocks.load.mockReturnValueOnce(loaded.promise);
		mocks.prepare.mockImplementationOnce(() => {
			preparing.resolve();
			return prepared.promise;
		});
		let returned = false;
		const startup = loadDirectory().then((directory) => {
			returned = true;
			return directory;
		});
		expect(returned).toBe(false);
		expect(mocks.prepare).not.toHaveBeenCalled();
		const config = configuration();
		loaded.resolve(config);
		await preparing.promise;
		expect(returned).toBe(false);
		const snapshot = realSnapshot.prepareSnapshot(config);
		prepared.resolve(snapshot);
		const directory = await startup;
		const current: PreparedSnapshot = directory.currentSnapshot();
		expect(current).toBe(snapshot);
		expect(current.display.site.title).toBe('boot');
		expect(directory).not.toHaveProperty('start');
	});

	it('rejects invalid startup load with only safe, frozen loader diagnostics', async () => {
		const report = vi.fn();
		const failure = new ConfigError([
			{ code: 'missing_environment', path: `/links/${sentinel}/url` }
		]);
		mocks.load.mockRejectedValueOnce(failure);
		const error: unknown = await loadDirectory(undefined, { report }).catch(
			(error: unknown) => error
		);
		expect(error).toBeInstanceOf(DirectoryError);
		const issue = (error as DirectoryError).issue;
		expect(issue).toEqual({ code: 'load_failed', issues: failure.issues });
		expect(Object.isFrozen(issue)).toBe(true);
		expect(Object.isFrozen(issue.issues)).toBe(true);
		expect(Object.isFrozen(issue.issues?.[0])).toBe(true);
		expectRedacted(error);
		expect(report).not.toHaveBeenCalled();
		expect(mocks.prepare).not.toHaveBeenCalled();
	});

	it('redacts an unknown read failure at startup', async () => {
		const failure = Object.assign(new Error(sentinel), { cause: sentinel, value: sentinel });
		mocks.load.mockRejectedValueOnce(failure);
		const error: unknown = await loadDirectory(sentinel).catch((error: unknown) => error);
		expect(error).toBeInstanceOf(DirectoryError);
		expect((error as DirectoryError).issue).toEqual({ code: 'load_failed' });
		expectRedacted(error);
	});

	it('redacts a preparation failure at startup', async () => {
		mocks.prepare.mockImplementationOnce(() => {
			throw Object.assign(new Error(sentinel), { cause: sentinel, value: sentinel });
		});
		const error: unknown = await loadDirectory().catch((error: unknown) => error);
		expect(error).toBeInstanceOf(DirectoryError);
		expect((error as DirectoryError).issue).toEqual({ code: 'prepare_failed' });
		expectRedacted(error);
	});

	it('redacts path resolution failure before attempting a read', async () => {
		const cwd = vi.spyOn(process, 'cwd').mockImplementationOnce(() => {
			throw new Error(sentinel);
		});
		const startup = loadDirectory();
		cwd.mockRestore();
		const error: unknown = await startup.catch((error: unknown) => error);
		expect(error).toBeInstanceOf(DirectoryError);
		expect((error as DirectoryError).issue).toEqual({ code: 'load_failed' });
		expectRedacted(error);
		expect(mocks.load).not.toHaveBeenCalled();
	});

	it('resolves explicit and default paths once and forwards the selected environment', async () => {
		const report = vi.fn();
		const env = { CONFIG_PATH: 'config/first.yaml', PASSWORD: sentinel };
		const directory = await loadDirectory(undefined, { env, report });
		const pinned = resolve('config/first.yaml');
		expect(mocks.load).toHaveBeenLastCalledWith(pinned, { env });
		env.CONFIG_PATH = 'config/second.yaml';
		await directory.reload();
		expect(mocks.load).toHaveBeenLastCalledWith(pinned, { env });
		expect(mocks.load.mock.calls[1]?.[1]?.env).toBe(env);
		const explicit = await loadDirectory('custom/directory.yaml', { env, report });
		await explicit.reload();
		expect(mocks.load).toHaveBeenLastCalledWith(resolve('custom/directory.yaml'), { env });
		expect(report).not.toHaveBeenCalled();
	});
});

describe('filesystem integration', () => {
	it('loads disposable YAML with env and defaults, retains last good after an invalid edit, and recovers', async ({
		onTestFinished
	}) => {
		const temporary = await mkdtemp(join(tmpdir(), 'directory-directory-'));
		onTestFinished(() => rm(temporary, { recursive: true, force: true }));
		const configPath = join(temporary, sentinel);
		const source = `
site:
  title: \${DIRECTORY_TITLE}
  logo_path: /public/boot.svg
auth:
  credentials:
    username: family
    password: \${DIRECTORY_PASSWORD}
links:
  photos:
    title: Photos
    url: https://photos.example.com
    tags: photos, backup
`;
		await writeFile(configPath, source);
		const realConfig =
			await vi.importActual<typeof import('@directory/config')>('@directory/config');
		mocks.load.mockImplementation(realConfig.loadConfigFile);
		const report = vi.fn<(issue: DirectoryIssue) => void>();
		const env = {
			CONFIG_PATH: configPath,
			DIRECTORY_TITLE: 'Filesystem boot',
			DIRECTORY_PASSWORD: sentinel
		};
		const directory = await loadDirectory(undefined, { env, report });
		onTestFinished(() => directory.stop());
		const boot = directory.currentSnapshot();
		expect(boot.configuration.site.title).toBe('Filesystem boot');
		expect(boot.configuration.auth?.credentials?.password).toBe(sentinel);
		expect(boot.display.site).toEqual({
			title: 'Filesystem boot',
			description: '',
			footer: '',
			logo_path: '/public/boot.svg'
		});
		expect(boot.display.groups[0]?.links[0]?.tags).toEqual(['photos', 'backup']);
		expect(boot.assets.brandingPaths).toEqual(['/public/boot.svg']);
		expect(JSON.stringify(boot.display)).not.toContain(sentinel);

		await writeFile(configPath, `site: [\n${sentinel}`);
		await directory.reload();
		expect(directory.currentSnapshot()).toBe(boot);
		expect(report).toHaveBeenCalledExactlyOnceWith({
			code: 'load_failed',
			issues: [{ code: 'invalid_yaml', path: '/', message: 'Invalid YAML document.' }]
		});
		expectRedacted(report.mock.calls[0]?.[0]);

		env.CONFIG_PATH = join(temporary, 'does-not-exist.yaml');
		env.DIRECTORY_TITLE = 'Filesystem recovered';
		await writeFile(configPath, source.replace('boot.svg', 'recovered.svg'));
		await directory.reload();
		const recovered = directory.currentSnapshot();
		expect(recovered).not.toBe(boot);
		expect(recovered.configuration.site.title).toBe('Filesystem recovered');
		expect(recovered.display.site.title).toBe('Filesystem recovered');
		expect(recovered.assets.referencedPaths).toEqual(['/public/recovered.svg']);
		expect(recovered.display.snapshotId).not.toBe(boot.display.snapshotId);
		expect(boot.display.site.title).toBe('Filesystem boot');
		expect(boot.assets.referencedPaths).toEqual(['/public/boot.svg']);
		expect(report).toHaveBeenCalledTimes(1);

		const explicit = await loadDirectory(configPath, { env, report });
		onTestFinished(() => explicit.stop());
		expect(explicit.currentSnapshot().display.site.title).toBe('Filesystem recovered');
		expect(report).toHaveBeenCalledTimes(1);
	});
});

describe('owned snapshot reloads', () => {
	it('serializes load and preparation, coalescing bursts into one pending follow-up', async () => {
		const directory = await loadDirectory();
		const boot = directory.currentSnapshot();
		const firstLoad = Promise.withResolvers<DirectoryConfiguration>();
		const firstPrepare = Promise.withResolvers<void>();
		const preparing = Promise.withResolvers<void>();
		const secondLoad = Promise.withResolvers<DirectoryConfiguration>();
		const loadingAgain = Promise.withResolvers<void>();
		mocks.load.mockReturnValueOnce(firstLoad.promise).mockImplementationOnce(() => {
			loadingAgain.resolve();
			return secondLoad.promise;
		});
		mocks.prepare.mockImplementationOnce((config) => {
			preparing.resolve();
			return firstPrepare.promise.then(() => realSnapshot.prepareSnapshot(config));
		});
		const run = directory.reload();
		await Promise.resolve();
		for (let i = 0; i < 10; i++) expect(directory.reload()).toBe(run);
		expect(mocks.load).toHaveBeenCalledTimes(2);
		expect(mocks.prepare).toHaveBeenCalledTimes(1);
		firstLoad.resolve(configuration('one'));
		await preparing.promise;
		for (let i = 0; i < 10; i++) expect(directory.reload()).toBe(run);
		expect(mocks.load).toHaveBeenCalledTimes(2);
		expect(directory.currentSnapshot()).toBe(boot);
		firstPrepare.resolve();
		await loadingAgain.promise;
		expect(directory.currentSnapshot().display.site.title).toBe('one');
		expect(mocks.prepare).toHaveBeenCalledTimes(2);
		secondLoad.resolve(configuration('two'));
		await run;
		expect(mocks.load).toHaveBeenCalledTimes(3);
		expect(mocks.prepare).toHaveBeenCalledTimes(3);
		expect(directory.currentSnapshot().display.site.title).toBe('two');
	});

	it('keeps complete old captures while replacing private configuration, display and assets together', async () => {
		mocks.load.mockResolvedValueOnce(configuration('boot', credentials));
		const directory = await loadDirectory();
		const captured = directory.currentSnapshot();
		mocks.load.mockResolvedValueOnce(configuration('next', credentials));
		await directory.reload();
		const current = directory.currentSnapshot();
		expect(current).not.toBe(captured);
		expect(current.configuration.site.title).toBe('next');
		expect(current.display.site.title).toBe('next');
		expect(current.display.groups[0]?.links[0]?.title).toBe('next photos');
		expect(current.assets).toEqual({
			brandingPaths: ['/public/next.svg'],
			referencedPaths: ['/public/next.svg', '/public/next-photos.svg']
		});
		expect(current.display.snapshotId).not.toBe(captured.display.snapshotId);
		expect(captured.configuration.site.title).toBe('boot');
		expect(captured.display.site.title).toBe('boot');
		expect(captured.assets.referencedPaths).toEqual([
			'/public/boot.svg',
			'/public/boot-photos.svg'
		]);
		expect(JSON.stringify(current.display)).not.toContain(sentinel);
		expect(JSON.stringify(current.configuration)).toContain(sentinel);
		expect(Object.isFrozen(current)).toBe(true);
	});

	it('retains last good on load and preparation failures, then recovers', async () => {
		const report = vi.fn<(issue: DirectoryIssue) => void>();
		const directory = await loadDirectory(undefined, { report });
		const captured = directory.currentSnapshot();
		const invalid = new ConfigError([{ code: 'invalid_yaml', path: '/' }]);
		mocks.load.mockRejectedValueOnce(invalid);
		await directory.reload();
		expect(directory.currentSnapshot()).toBe(captured);
		expect(report).toHaveBeenLastCalledWith({ code: 'load_failed', issues: invalid.issues });
		mocks.prepare.mockImplementationOnce(() => {
			throw Object.assign(new Error(sentinel), { filename: sentinel, value: sentinel });
		});
		await directory.reload();
		expect(directory.currentSnapshot()).toBe(captured);
		expect(report).toHaveBeenLastCalledWith({ code: 'prepare_failed' });
		for (const [issue] of report.mock.calls) {
			expect(Object.isFrozen(issue)).toBe(true);
			expectRedacted(issue);
		}
		mocks.load.mockResolvedValueOnce(configuration('recovered'));
		await directory.reload();
		expect(directory.currentSnapshot().display.site.title).toBe('recovered');
		expect(directory.currentSnapshot()).not.toBe(captured);
	});

	it('runs a queued follow-up after failure even when synchronous reporting throws', async () => {
		const report = vi.fn(() => {
			throw new Error(sentinel);
		});
		const directory = await loadDirectory(undefined, { report });
		const pending = Promise.withResolvers<DirectoryConfiguration>();
		mocks.load.mockReturnValueOnce(pending.promise).mockResolvedValue(configuration('recovered'));
		const run = directory.reload();
		await Promise.resolve();
		expect(directory.reload()).toBe(run);
		pending.reject(new Error(sentinel));
		await expect(run).resolves.toBeUndefined();
		expect(report).toHaveBeenCalledExactlyOnceWith({ code: 'load_failed' });
		expect(directory.currentSnapshot().display.site.title).toBe('recovered');
		await directory.reload();
		expect(mocks.load).toHaveBeenCalledTimes(4);
	});
});

describe('boot authentication', () => {
	it('rejects enabling auth on an unauthenticated boot, then accepts restored absent auth', async () => {
		const report = vi.fn();
		const directory = await loadDirectory(undefined, { report });
		const boot = directory.currentSnapshot();
		mocks.load.mockResolvedValueOnce(configuration('rejected', credentials));
		await directory.reload();
		expect(directory.currentSnapshot()).toBe(boot);
		expect(mocks.prepare).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalledExactlyOnceWith({ code: 'restart_required' });
		mocks.load.mockResolvedValueOnce(configuration('restored'));
		await directory.reload();
		expect(directory.currentSnapshot().display.site.title).toBe('restored');
	});

	it('rejects changed or disabled boot auth as a whole and accepts structural restoration in a different key order', async () => {
		const report = vi.fn();
		mocks.load.mockResolvedValueOnce(configuration('boot', oidc));
		const directory = await loadDirectory(undefined, { report });
		const boot = directory.currentSnapshot();
		mocks.load.mockResolvedValueOnce(
			configuration('changed', { oidc: { ...oidc.oidc, client_secret: 'changed' } })
		);
		await directory.reload();
		expect(directory.currentSnapshot()).toBe(boot);
		mocks.load.mockResolvedValueOnce(configuration('disabled'));
		await directory.reload();
		expect(directory.currentSnapshot()).toBe(boot);
		expect(mocks.prepare).toHaveBeenCalledTimes(1);
		expect(report.mock.calls).toEqual([
			[{ code: 'restart_required' }],
			[{ code: 'restart_required' }]
		]);
		expectRedacted(report.mock.calls);
		const restored = configuration('restored', oidc);
		restored.auth = {
			oidc: {
				client_secret: sentinel,
				client_id: 'directory',
				issuer: 'https://identity.example.com'
			}
		};
		mocks.load.mockResolvedValueOnce(restored);
		await directory.reload();
		expect(directory.currentSnapshot().display.site.title).toBe('restored');
		expect(directory.currentSnapshot().assets.brandingPaths).toEqual(['/public/restored.svg']);
	});

	it('owns frozen boot auth and prepared data independently of mutable loader results', async () => {
		const input = configuration('boot', credentials);
		mocks.load.mockResolvedValue(input);
		const report = vi.fn();
		const directory = await loadDirectory(undefined, { report });
		const boot = directory.currentSnapshot();
		input.site.title = 'mutated';
		input.site.logo_path = '/public/mutated.svg';
		input.links.photos!.tags = 'mutated';
		input.auth!.credentials!.password = 'mutated';
		expect(Object.isFrozen(input)).toBe(false);
		expect(Object.isFrozen(boot.configuration.auth?.credentials)).toBe(true);
		expect(boot.configuration.auth?.credentials?.password).toBe(sentinel);
		expect(boot.display.groups[0]?.links[0]?.tags).toEqual(['photos', 'backup']);
		await directory.reload();
		expect(directory.currentSnapshot()).toBe(boot);
		expect(boot.display.site.title).toBe('boot');
		expect(boot.assets.brandingPaths).toEqual(['/public/boot.svg']);
		expect(report).toHaveBeenCalledExactlyOnceWith({ code: 'restart_required' });
		mocks.load.mockResolvedValueOnce(configuration('restored', credentials));
		await directory.reload();
		expect(directory.currentSnapshot().display.site.title).toBe('restored');
	});
});

describe('terminal stop', () => {
	it('discards a completed load, suppressing preparation and queued work after stop', async () => {
		const report = vi.fn();
		const directory = await loadDirectory(undefined, { report });
		const boot = directory.currentSnapshot();
		const pending = Promise.withResolvers<DirectoryConfiguration>();
		mocks.load.mockReturnValueOnce(pending.promise);
		const run = directory.reload();
		await Promise.resolve();
		expect(directory.reload()).toBe(run);
		directory.stop();
		directory.stop();
		pending.resolve(configuration('discarded', credentials));
		await run;
		await directory.reload();
		expect(directory.currentSnapshot()).toBe(boot);
		expect(mocks.load).toHaveBeenCalledTimes(2);
		expect(mocks.prepare).toHaveBeenCalledTimes(1);
		expect(report).not.toHaveBeenCalled();
	});

	it('discards completed preparation and queued work after stop', async () => {
		const report = vi.fn();
		const directory = await loadDirectory(undefined, { report });
		const boot = directory.currentSnapshot();
		const pending = Promise.withResolvers<PreparedSnapshot>();
		const entered = Promise.withResolvers<void>();
		mocks.prepare.mockImplementationOnce(() => {
			entered.resolve();
			return pending.promise;
		});
		const run = directory.reload();
		await entered.promise;
		expect(directory.reload()).toBe(run);
		directory.stop();
		pending.resolve(realSnapshot.prepareSnapshot(configuration('discarded')));
		await run;
		await directory.reload();
		expect(directory.currentSnapshot()).toBe(boot);
		expect(mocks.load).toHaveBeenCalledTimes(2);
		expect(report).not.toHaveBeenCalled();
	});

	it.each(['load', 'prepare'] as const)(
		'suppresses late %s rejection reports after stop',
		async (stage) => {
			const report = vi.fn();
			const directory = await loadDirectory(undefined, { report });
			const boot = directory.currentSnapshot();
			const pending = Promise.withResolvers<never>();
			const entered = Promise.withResolvers<void>();
			mocks[stage].mockImplementationOnce(() => {
				entered.resolve();
				return pending.promise;
			});
			const run = directory.reload();
			await entered.promise;
			expect(directory.reload()).toBe(run);
			directory.stop();
			pending.reject(new Error(sentinel));
			await expect(run).resolves.toBeUndefined();
			await directory.reload();
			expect(directory.currentSnapshot()).toBe(boot);
			expect(mocks.load).toHaveBeenCalledTimes(2);
			expect(report).not.toHaveBeenCalled();
		}
	);

	it('does not enter a scheduled reload stopped before work begins', async () => {
		const directory = await loadDirectory();
		const run = directory.reload();
		directory.stop();
		await run;
		await directory.reload();
		expect(mocks.load).toHaveBeenCalledTimes(1);
	});
});
