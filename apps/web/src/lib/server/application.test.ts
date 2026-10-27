import { inspect } from 'node:util';
import { validateConfig } from '@directory/config';
import type { DirectoryConfiguration } from '@directory/config/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from './application.js';
import type { Authentication } from './auth/index.js';
import { DirectoryError } from './directory-error.js';

const mocks = vi.hoisted(() => ({
	prepare: vi.fn<typeof import('./directory/snapshot.js').prepareSnapshot>(),
	authenticate: vi.fn<typeof import('./auth/index.js').createAuthentication>(),
	report: vi.fn<typeof import('./logger.js').reportDirectoryIssue>()
}));
vi.mock('./directory/snapshot.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./directory/snapshot.js')>()),
	prepareSnapshot: mocks.prepare
}));
vi.mock('./auth/index.js', () => ({ createAuthentication: mocks.authenticate }));
vi.mock('./logger.js', () => ({ reportDirectoryIssue: mocks.report }));

const realSnapshot =
	await vi.importActual<typeof import('./directory/snapshot.js')>('./directory/snapshot.js');
const sentinel = 'PRIVATE-password-env-filename.yml';
const credentials = {
	origin: 'https://directory.example.com',
	credentials: { username: 'family', password: sentinel }
};
const authentication: Authentication = {
	strategy: 'credentials',
	handle: vi.fn(),
	signIn: vi.fn(),
	signOut: vi.fn()
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
					tags: [' photos ', ' backup ']
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

function captureDirectoryError(action: () => unknown): DirectoryError {
	try {
		action();
	} catch (error) {
		expect(error).toBeInstanceOf(DirectoryError);
		expectRedacted(error);
		return error as DirectoryError;
	}
	throw new Error('Expected a synchronous DirectoryError');
}

beforeEach(() => {
	mocks.prepare.mockReset().mockImplementation(realSnapshot.prepareSnapshot);
	mocks.authenticate.mockReset().mockReturnValue(authentication);
	mocks.report.mockReset();
});

describe('application startup', () => {
	it('synchronously prepares private configuration and constructs authentication from that snapshot', () => {
		const initial = configuration('boot', credentials);
		const app = createApplication(initial);
		const snapshot = app.currentSnapshot();
		expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(initial);
		expect(snapshot).toBe(mocks.prepare.mock.results[0]!.value);
		expect(mocks.authenticate).toHaveBeenCalledExactlyOnceWith(snapshot.configuration.auth);
		expect(mocks.authenticate.mock.calls[0]![0]).toBe(snapshot.configuration.auth);
		expect(app.authentication).toBe(authentication);
		expect(snapshot.configuration.auth?.credentials?.password).toBe(sentinel);
		expect(snapshot.configuration.auth).not.toHaveProperty('secret');
		expect(snapshot.display.groups[0]?.links[0]?.tags).toEqual(['photos', 'backup']);
		expect(snapshot.assets.referencedPaths).toEqual([
			'/public/boot.svg',
			'/public/boot-photos.svg'
		]);
		expectRedacted(snapshot.display);
		expect(mocks.report).not.toHaveBeenCalled();
	});

	it('does not construct authentication when it is absent', () => {
		expect(createApplication(configuration()).authentication).toBeUndefined();
		expect(mocks.authenticate).not.toHaveBeenCalled();
	});

	it.each(['prepare_failed', 'auth_failed'] as const)('redacts %s at startup', (code) => {
		const fail = () => {
			throw Object.assign(new Error(sentinel), { cause: sentinel, value: sentinel });
		};
		if (code === 'prepare_failed') mocks.prepare.mockImplementationOnce(fail);
		else mocks.authenticate.mockImplementationOnce(fail);
		const error = captureDirectoryError(() =>
			createApplication(configuration('boot', credentials))
		);
		expect(error.issue).toEqual({ code });
		if (code === 'prepare_failed') expect(mocks.authenticate).not.toHaveBeenCalled();
		expect(mocks.report).not.toHaveBeenCalled();
	});
});

describe('application config policy', () => {
	it('replaces all snapshot views together, preserving old captures and the original authentication', () => {
		const initial = configuration('boot', credentials);
		const app = createApplication(initial);
		const captured = app.currentSnapshot();
		const next = configuration('next', credentials);
		mocks.prepare.mockImplementationOnce((config) => {
			expect(app.currentSnapshot()).toBe(captured);
			return realSnapshot.prepareSnapshot(config);
		});
		expect(app.onConfigChange(next, initial)).toBe(true);
		const current = app.currentSnapshot();
		expect(current).not.toBe(captured);
		expect(current.configuration.site.title).toBe('next');
		expect(current.display.site.title).toBe('next');
		expect(current.display.groups[0]?.links[0]?.title).toBe('next photos');
		expect(current.assets.referencedPaths).toEqual(['/public/next.svg', '/public/next-photos.svg']);
		expect(current.assets.bookmarkLogos.photos).not.toBe(captured.assets.bookmarkLogos.photos);
		expect(current.display.snapshotId).not.toBe(captured.display.snapshotId);
		expect(captured.configuration.site.title).toBe('boot');
		expect(captured.display.site.title).toBe('boot');
		expect(captured.display.groups[0]?.links[0]?.title).toBe('boot photos');
		expect(captured.assets.referencedPaths).toEqual([
			'/public/boot.svg',
			'/public/boot-photos.svg'
		]);
		expectRedacted(current.display);
		expect(app.authentication).toBe(authentication);
		expect(mocks.authenticate).toHaveBeenCalledOnce();
		expect(mocks.report).not.toHaveBeenCalled();
	});

	it('accepts equivalent normalized values and mapping-key order without preparing or publishing', () => {
		const initial = configuration('boot', credentials);
		const app = createApplication(initial);
		const accepted = configuration('accepted', credentials);
		expect(app.onConfigChange(accepted, initial)).toBe(true);
		const current = app.currentSnapshot();
		// Source formatting is gone by this boundary; independently loaded values matter.
		const equivalent = configuration('accepted', credentials);
		equivalent.site = Object.fromEntries(
			Object.entries(equivalent.site).reverse()
		) as DirectoryConfiguration['site'];
		equivalent.auth = {
			credentials: { password: sentinel, username: 'family' },
			origin: credentials.origin
		};
		expect(app.onConfigChange(equivalent, accepted)).toBe(true);
		expect(app.onConfigChange(configuration('accepted', credentials), equivalent)).toBe(true);
		expect(app.currentSnapshot()).toBe(current);
		expect(mocks.prepare).toHaveBeenCalledTimes(2);
		expect(mocks.authenticate).toHaveBeenCalledOnce();
		expect(mocks.report).not.toHaveBeenCalled();
	});

	it('publishes bookmark declaration order even when mapping values are equal', () => {
		const initial = validateConfig({
			links: {
				zebra: { title: 'Zebra', url: 'https://zebra.example.com', group: 'Tools' },
				alpha: { title: 'Alpha', url: 'https://alpha.example.com', group: 'Family' },
				beta: { title: 'Beta', url: 'https://beta.example.com', group: 'Tools' }
			}
		});
		const app = createApplication(initial);
		const captured = app.currentSnapshot();
		const reordered = {
			...initial,
			links: { alpha: initial.links.alpha!, beta: initial.links.beta!, zebra: initial.links.zebra! }
		};
		expect(reordered).toEqual(initial);
		expect(app.onConfigChange(reordered, initial)).toBe(true);
		const current = app.currentSnapshot();
		expect(current.display.snapshotId).not.toBe(captured.display.snapshotId);
		expect(current.display.groups.map((group) => group.label)).toEqual(['Family', 'Tools']);
		expect(current.display.groups.map((group) => group.links.map((link) => link.id))).toEqual([
			['alpha'],
			['beta', 'zebra']
		]);
		expect(captured.display.groups.map((group) => group.links.map((link) => link.id))).toEqual([
			['zebra', 'beta'],
			['alpha']
		]);
		expect(mocks.prepare).toHaveBeenCalledTimes(2);
	});

	it.each([
		{ change: 'enable auth', before: undefined, after: credentials },
		{ change: 'disable auth', before: credentials, after: undefined },
		{
			change: 'origin',
			before: credentials,
			after: { ...credentials, origin: 'https://other.example.com' }
		},
		{
			change: 'password',
			before: credentials,
			after: { ...credentials, credentials: { ...credentials.credentials, password: 'changed' } }
		},
		{
			change: 'session secret',
			before: { ...credentials, secret: `${sentinel}-session` },
			after: { ...credentials, secret: `${sentinel}-replacement` }
		}
	])('rejects the whole config for $change until auth is restored', ({ before, after }) => {
		const initial = configuration('boot', before);
		const app = createApplication(initial);
		const accepted = configuration('accepted', before);
		expect(app.onConfigChange(accepted, initial)).toBe(true);
		const captured = app.currentSnapshot();
		expect(app.onConfigChange(configuration('rejected', after), accepted)).toBe(false);
		expect(app.currentSnapshot()).toBe(captured);
		expect(mocks.prepare).toHaveBeenCalledTimes(2);
		expect(mocks.report).toHaveBeenCalledExactlyOnceWith({ code: 'restart_required' });
		expectRedacted(mocks.report.mock.calls);
		const restored = configuration('restored', before);
		expect(app.onConfigChange(restored, accepted)).toBe(true);
		expect(app.currentSnapshot().display.site.title).toBe('restored');
		expect(app.currentSnapshot().configuration.auth).toEqual(before);
		expect(app.authentication).toBe(before === undefined ? undefined : authentication);
		expect(mocks.authenticate).toHaveBeenCalledTimes(before === undefined ? 0 : 1);
	});

	it('throws a safe preparation failure, retains last good, and recovers using the accepted baseline', () => {
		const initial = configuration();
		const app = createApplication(initial);
		const accepted = configuration('accepted');
		expect(app.onConfigChange(accepted, initial)).toBe(true);
		const captured = app.currentSnapshot();
		mocks.prepare.mockImplementationOnce(() => {
			throw Object.assign(new Error(sentinel), { cause: sentinel, value: sentinel });
		});
		const error = captureDirectoryError(() =>
			app.onConfigChange(configuration('failed'), accepted)
		);
		expect(error.issue).toEqual({ code: 'prepare_failed' });
		expect(app.currentSnapshot()).toBe(captured);
		// The generic monitor, not this callback, reports thrown failures.
		expect(mocks.report).not.toHaveBeenCalled();
		expect(app.onConfigChange(configuration('accepted'), accepted)).toBe(true);
		expect(app.currentSnapshot()).toBe(captured);
		expect(mocks.prepare).toHaveBeenCalledTimes(3);
		expect(app.onConfigChange(configuration('recovered'), accepted)).toBe(true);
		expect(app.currentSnapshot().display.site.title).toBe('recovered');
		expect(captured.display.site.title).toBe('accepted');
	});
});
