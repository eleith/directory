import { validateConfig } from '@directory/config';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Directory } from './lib/server/config/load-directory.js';

const adapterEvents: NodeJS.EventEmitter = process;

const mocks = vi.hoisted(() => ({
	building: false,
	dev: false,
	boot: vi.fn<typeof import('./lib/server/boot.js').bootApp>(),
	report: vi.fn<typeof import('./lib/server/logger.js').reportStartupFailure>(),
	load: vi.fn<typeof import('@directory/config').loadConfigFile>(),
	path: vi.fn<typeof import('@directory/config').resolveConfigPath>(),
	prepare: vi.fn<typeof import('./lib/server/config/snapshot.js').prepareSnapshot>()
}));

vi.mock('$app/environment', () => ({
	get building() {
		return mocks.building;
	},
	get dev() {
		return mocks.dev;
	}
}));
vi.mock('./lib/server/boot.js', () => ({ bootApp: mocks.boot }));
vi.mock('./lib/server/logger.js', () => ({ reportStartupFailure: mocks.report }));
vi.mock('@directory/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@directory/config')>()),
	loadConfigFile: mocks.load,
	resolveConfigPath: mocks.path
}));
vi.mock('./lib/server/config/snapshot.js', () => ({ prepareSnapshot: mocks.prepare }));

const realSnapshot = await vi.importActual<typeof import('./lib/server/config/snapshot.js')>(
	'./lib/server/config/snapshot.js'
);
const sentinel = 'PRIVATE-config-password-not-for-browser';
type Resolve = Parameters<Handle>[0]['resolve'];

function snapshot(title: string) {
	return realSnapshot.prepareSnapshot(
		validateConfig(
			{
				site: { title, description: `${title} description` },
				auth: { credentials: { username: 'family', password: sentinel } },
				links: { photos: { title: 'Photos', url: 'https://photos.example.com' } }
			},
			{ env: {} }
		)
	);
}

function event(): RequestEvent {
	return { locals: {} } as RequestEvent;
}

function directory(title: string) {
	return {
		currentSnapshot: vi.fn().mockReturnValue(snapshot(title)),
		reload: vi.fn<Directory['reload']>(),
		stop: vi.fn()
	};
}

let listeners: MockInstance<typeof process.once>;
let production: MockInstance<typeof import('./lib/server/lifecycle/production.js').startProduction>;
let development: MockInstance<
	typeof import('./lib/server/lifecycle/development.js').startDevelopment
>;
beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	mocks.building = false;
	mocks.dev = false;
	mocks.boot.mockReset();
	listeners = vi.spyOn(process, 'once');
	production = vi.spyOn(await import('./lib/server/lifecycle/production.js'), 'startProduction');
	development = vi.spyOn(await import('./lib/server/lifecycle/development.js'), 'startDevelopment');
});

afterEach(() => {
	for (const [name, listener] of listeners.mock.calls) {
		if (name === 'sveltekit:shutdown' || name === 'directory:dev-stop') process.off(name, listener);
	}
	vi.restoreAllMocks();
});

describe('server hooks', () => {
	it.each([false, true])('skips all startup during Kit build analysis (dev=%s)', async (dev) => {
		mocks.building = true;
		mocks.dev = dev;
		const emit = vi.spyOn(process, 'emit');
		const hooks = await import('./hooks.server.js');
		await hooks.init();
		expect(production).not.toHaveBeenCalled();
		expect(development).not.toHaveBeenCalled();
		expect(mocks.boot).not.toHaveBeenCalled();
		expect(mocks.path).not.toHaveBeenCalled();
		expect(mocks.load).not.toHaveBeenCalled();
		expect(mocks.prepare).not.toHaveBeenCalled();
		expect(
			listeners.mock.calls.filter(
				([name]) => name === 'sveltekit:shutdown' || name === 'directory:dev-stop'
			)
		).toEqual([]);
		expect(emit).not.toHaveBeenCalledWith('directory:dev-stop');
	});

	it('dispatches production startup and serves only after boot, until shutdown', async () => {
		const pending = Promise.withResolvers<Directory>();
		const ready = directory('Ready');
		mocks.boot.mockReturnValueOnce(pending.promise);
		const hooks = await import('./hooks.server.js');
		const resolve = vi.fn<Resolve>().mockResolvedValue(new Response('Ready'));
		const startup = hooks.init();
		expect(production).toHaveBeenCalledOnce();
		expect(development).not.toHaveBeenCalled();
		const unavailable = await hooks.handle({ event: event(), resolve });
		expect(unavailable.status).toBe(503);
		expect(await unavailable.text()).toBe('Service unavailable');
		expect(resolve).not.toHaveBeenCalled();
		expect(ready.currentSnapshot).not.toHaveBeenCalled();
		pending.resolve(ready);
		await startup;
		expect(mocks.boot).toHaveBeenCalledExactlyOnceWith();
		expect((await hooks.handle({ event: event(), resolve })).status).toBe(200);
		adapterEvents.emit('sveltekit:shutdown');
		expect((await hooks.handle({ event: event(), resolve })).status).toBe(503);
	});

	it('dispatches development startup', async () => {
		mocks.dev = true;
		mocks.boot.mockResolvedValueOnce(directory('Development'));
		const hooks = await import('./hooks.server.js');
		await hooks.init();
		expect(development).toHaveBeenCalledOnce();
		expect(production).not.toHaveBeenCalled();
		expect(mocks.boot).toHaveBeenCalledExactlyOnceWith();
		process.emit('directory:dev-stop');
	});

	it.each([false, true])('redacts startup failure at the common boundary (dev=%s)', async (dev) => {
		mocks.dev = dev;
		const error = new Error(sentinel, { cause: sentinel });
		mocks.boot.mockRejectedValueOnce(error);
		const hooks = await import('./hooks.server.js');
		const failure: unknown = await hooks.init()?.catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(Error);
		expect(failure).not.toBe(error);
		expect((failure as Error).message).toBe('Application startup failed.');
		expect(String(failure)).not.toContain(sentinel);
		expect((failure as Error).stack).not.toContain(sentinel);
		expect(failure).not.toHaveProperty('cause');
		expect(mocks.report).toHaveBeenCalledExactlyOnceWith(error);
		const resolve = vi.fn<Resolve>();
		expect((await hooks.handle({ event: event(), resolve })).status).toBe(503);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('captures exactly once per request so nested loaders keep the original snapshot after publication', async () => {
		const initial = snapshot('Initial');
		const replacement = snapshot('Replacement');
		let published = initial;
		const directory = {
			currentSnapshot: vi.fn(() => published),
			reload: vi.fn<Directory['reload']>(),
			stop: vi.fn()
		};
		mocks.boot.mockResolvedValueOnce(directory);
		const hooks = await import('./hooks.server.js');
		await hooks.init();
		const resolve = vi.fn<Resolve>().mockImplementation(async (event) => {
			const parent = async () => {
				const captured = event.locals.snapshot;
				published = replacement;
				return captured.display.site.title;
			};
			const first = await parent();
			const second = event.locals.snapshot.display.site.title;
			return Response.json({ first, second });
		});
		const firstEvent = event();
		const first = await hooks.handle({ event: firstEvent, resolve });
		expect(directory.currentSnapshot).toHaveBeenCalledOnce();
		expect(firstEvent.locals.snapshot).toBe(initial);
		const body = await first.text();
		expect(JSON.parse(body)).toEqual({ first: 'Initial', second: 'Initial' });
		expect(body).not.toContain(sentinel);
		expect(body).not.toContain('configuration');
		expect(body).not.toContain('auth');
		const secondEvent = event();
		const second = await hooks.handle({ event: secondEvent, resolve });
		expect(directory.currentSnapshot).toHaveBeenCalledTimes(2);
		expect(secondEvent.locals.snapshot).toBe(replacement);
		expect(await second.json()).toEqual({ first: 'Replacement', second: 'Replacement' });
		expect(mocks.boot).toHaveBeenCalledOnce();
		expect(mocks.path).not.toHaveBeenCalled();
		expect(mocks.load).not.toHaveBeenCalled();
		expect(mocks.prepare).not.toHaveBeenCalled();
		expect(directory.reload).not.toHaveBeenCalled();
	});
});
