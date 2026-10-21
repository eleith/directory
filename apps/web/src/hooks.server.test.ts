import { validateConfig } from '@directory/config';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { themeStyleTag } from './lib/server/appearance.js';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Authentication } from './lib/server/auth/index.js';
import { requireSignIn } from './lib/server/auth/access.js';
import { readImage } from './lib/server/assets.js';
import { GET as mountedImage } from './routes/(protected)/(endpoints)/public/[...file]/+server.js';
import { GET as bookmarkLogo } from './routes/(protected)/(endpoints)/bookmarks/[id]/logo/+server.js';
import type { Application } from './lib/server/lifecycle/application.js';
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
// Supply request tracing context while exercising Kit's real sequence/options composition.
vi.mock('@sveltejs/kit/hooks', async (importOriginal) => {
	const { sequence } = await importOriginal<typeof import('@sveltejs/kit/hooks')>();
	const { with_request_store } = await vi.importActual<{
		with_request_store: (store: unknown, run: () => ReturnType<Handle>) => ReturnType<Handle>;
	}>('@sveltejs/kit/internal/server');
	return {
		sequence: (...handlers: Handle[]): Handle => {
			const handle = sequence(...handlers);
			return (input) =>
				with_request_store(
					{
						event: input.event,
						state: { tracing: { record_span: ({ fn }: { fn: () => unknown }) => fn() } }
					},
					() => handle(input)
				);
		}
	};
});
vi.mock('./lib/server/assets.js', () => ({ readImage: vi.fn() }));
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

function snapshot(title: string, light = '#13579b', dark = '#c4d6e8') {
	return realSnapshot.prepareSnapshot(
		validateConfig(
			{
				site: { title, description: `${title} description`, favicon_path: '/public/site.svg' },
				appearance: { primary_light_color: light, primary_dark_color: dark },
				auth: { credentials: { username: 'family', password: sentinel } },
				links: {
					photos: {
						title: 'Photos',
						url: 'https://photos.example.com',
						logo_path: '/public/photo.svg'
					}
				}
			},
			{ env: {} }
		)
	);
}

function event(): RequestEvent {
	return { locals: {} } as RequestEvent;
}

function application(title: string, authentication?: Authentication) {
	return {
		directory: {
			currentSnapshot: vi.fn().mockReturnValue(snapshot(title)),
			reload: vi.fn<Directory['reload']>(),
			stop: vi.fn<Directory['stop']>()
		},
		publicDir: '/mounted/public',
		authentication,
		stop: vi.fn<Application['stop']>()
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
		const pending = Promise.withResolvers<Application>();
		const ready = application('Ready');
		mocks.boot.mockReturnValueOnce(pending.promise);
		const hooks = await import('./hooks.server.js');
		const resolve = vi.fn<Resolve>().mockResolvedValue(new Response('Ready'));
		const startup = hooks.init();
		expect(production).toHaveBeenCalledOnce();
		expect(development).not.toHaveBeenCalled();
		const unavailable = await hooks.handle({ event: event(), resolve });
		expect(unavailable.status).toBe(503);
		expect(unavailable.headers.get('cache-control')).toBe('no-store');
		expect(await unavailable.text()).toBe('Service unavailable');
		expect(resolve).not.toHaveBeenCalled();
		expect(ready.directory.currentSnapshot).not.toHaveBeenCalled();
		pending.resolve(ready);
		await startup;
		expect(mocks.boot).toHaveBeenCalledExactlyOnceWith();
		expect((await hooks.handle({ event: event(), resolve })).status).toBe(200);
		adapterEvents.emit('sveltekit:shutdown');
		expect((await hooks.handle({ event: event(), resolve })).status).toBe(503);
	});

	it('dispatches development startup', async () => {
		mocks.dev = true;
		mocks.boot.mockResolvedValueOnce(application('Development'));
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

	it.each(['credentials', 'oidc'] as const)(
		'forwards enabled %s auth to its boot-owned native pipeline after setting locals',
		async (strategy) => {
			const response = new Response('Native pipeline', { status: 401 });
			const authentication: Authentication = {
				strategy,
				handle: vi.fn<Handle>().mockImplementation(async ({ event }) => {
					expect(event.locals.snapshot).toBe(
						ready.directory.currentSnapshot.mock.results[0]?.value
					);
					expect(event.locals.publicDir).toBe(ready.publicDir);
					expect(event.locals.authentication).toBe(authentication);
					expect(event.locals.session).toBeNull();
					return response;
				}),
				signIn: vi.fn<Authentication['signIn']>().mockResolvedValue(undefined),
				signOut: vi.fn<Authentication['signOut']>().mockResolvedValue(undefined)
			};
			const ready = application('Enabled', authentication);
			mocks.boot.mockResolvedValueOnce(ready);
			const hooks = await import('./hooks.server.js');
			await hooks.init();
			const request = event();
			const resolve = vi.fn<Resolve>();
			expect(await hooks.handle({ event: request, resolve })).toBe(response);
			expect(authentication.handle).toHaveBeenCalledExactlyOnceWith({
				event: expect.objectContaining({ locals: request.locals }),
				resolve: expect.any(Function)
			});
			expect(ready.directory.currentSnapshot).toHaveBeenCalledOnce();
			expect(resolve).not.toHaveBeenCalled();
			expect(authentication.signIn).not.toHaveBeenCalled();
			expect(authentication.signOut).not.toHaveBeenCalled();
			expect(mocks.boot).toHaveBeenCalledOnce();
		}
	);

	it.each(['GET', 'HEAD'])(
		'never reaches an image reader before authentication for %s, including the configured favicon',
		async (method) => {
			const session = vi.fn<App.Locals['auth']>().mockResolvedValue(null);
			const authentication: Authentication = {
				strategy: 'credentials',
				handle: async (input) => {
					input.event.locals.auth = session;
					return requireSignIn(input, {
						origin: 'https://directory.example',
						strategy: 'credentials'
					});
				},
				signIn: vi.fn<Authentication['signIn']>(),
				signOut: vi.fn<Authentication['signOut']>()
			};
			const ready = application('Ready', authentication);
			mocks.boot.mockResolvedValueOnce(ready);
			const hooks = await import('./hooks.server.js');
			await hooks.init();
			const resolve = vi.fn<Resolve>().mockImplementation(async (event) => {
				if (event.route.id === '/(protected)/(endpoints)/public/[...file]') {
					return mountedImage(event as Parameters<typeof mountedImage>[0]);
				}
				return bookmarkLogo(event as Parameters<typeof bookmarkLogo>[0]);
			});
			for (const cookie of ['', 'authjs.session-token=invalid-session']) {
				for (const [path, routeId, params] of [
					['/public/photo.svg', '/(protected)/(endpoints)/public/[...file]', { file: 'photo.svg' }],
					['/public/site.svg', '/(protected)/(endpoints)/public/[...file]', { file: 'site.svg' }],
					[
						'/%70ublic/photo.svg',
						'/(protected)/(endpoints)/public/[...file]',
						{ file: 'photo.svg' }
					],
					[
						'/public/unknown.svg',
						'/(protected)/(endpoints)/public/[...file]',
						{ file: 'unknown.svg' }
					],
					[
						'/bookmarks/photos/logo',
						'/(protected)/(endpoints)/bookmarks/[id]/logo',
						{ id: 'photos' }
					],
					[
						'/%62ookmarks/photos/logo',
						'/(protected)/(endpoints)/bookmarks/[id]/logo',
						{ id: 'photos' }
					]
				] as const) {
					const url = new URL(path, 'https://directory.example');
					const request = {
						url,
						request: new Request(url, { method, headers: { accept: 'text/html', cookie } }),
						route: { id: routeId },
						params,
						isDataRequest: false,
						locals: {}
					} as unknown as RequestEvent;
					expect((await hooks.handle({ event: request, resolve })).status).toBe(401);
					expect(request.locals.publicDir).toBe(ready.publicDir);
				}
			}
			expect(session).toHaveBeenCalledTimes(12);
			expect(resolve).not.toHaveBeenCalled();
			expect(readImage).not.toHaveBeenCalled();

			session.mockResolvedValue({ user: { name: 'Directory' }, expires: '2030-01-01' });
			vi.mocked(readImage).mockResolvedValue({
				bytes: new TextEncoder().encode('<svg/>'),
				contentType: 'image/svg+xml'
			});
			const url = new URL('https://directory.example/public/photo.svg');
			const authorized = {
				url,
				request: new Request(url, { method }),
				route: { id: '/(protected)/(endpoints)/public/[...file]' },
				params: { file: 'photo.svg' },
				isDataRequest: false,
				locals: {}
			} as unknown as RequestEvent;
			expect((await hooks.handle({ event: authorized, resolve })).status).toBe(200);
			expect(readImage).toHaveBeenCalledExactlyOnceWith(ready.publicDir, '/public/photo.svg');
		}
	);

	it.each(['none', 'credentials', 'oidc'] as const)(
		'inserts the captured theme once in streamed HTML via native resolve composition (%s)',
		async (strategy) => {
			const authTransform = vi.fn(({ html }: { html: string }) => html);
			const filterSerializedResponseHeaders = vi.fn(() => false);
			const preload = vi.fn(() => false);
			let authentication: Authentication | undefined;
			if (strategy !== 'none') {
				authentication = {
					strategy,
					handle: ({ event, resolve }) =>
						resolve(event, {
							transformPageChunk: authTransform,
							filterSerializedResponseHeaders,
							preload
						}),
					signIn: vi.fn<Authentication['signIn']>(),
					signOut: vi.fn<Authentication['signOut']>()
				};
			}
			const ready = application('Initial', authentication);
			const captured = ready.directory.currentSnapshot();
			ready.directory.currentSnapshot.mockClear();
			const before = JSON.stringify(captured);
			const replacement = snapshot('Replacement', '#abc', '#def');
			mocks.boot.mockResolvedValueOnce(ready);
			const hooks = await import('./hooks.server.js');
			await hooks.init();
			const request = event();
			const resolve = vi.fn<Resolve>().mockImplementation(async (event, options) => {
				expect(event.locals).toBe(request.locals);
				expect(event.locals.snapshot).toBe(captured);
				ready.directory.currentSnapshot.mockReturnValue(replacement);
				const transform = options?.transformPageChunk;
				if (transform === undefined) throw new Error('Missing theme transform');
				if (strategy !== 'none') {
					expect(options?.filterSerializedResponseHeaders).toBe(filterSerializedResponseHeaders);
					expect(options?.preload).toBe(preload);
				}
				const opening = '<!doctype html><html><head><title>Sign in</title>';
				const head = '</head><body>Sign in';
				const ending = '</body></html>';
				expect(await transform({ html: opening, done: false })).toBe(opening);
				const themedHead = await transform({ html: head, done: false });
				expect(themedHead).toBe(`\t${themeStyleTag(captured.display.appearance)}\n${head}`);
				expect(await transform({ html: ending, done: true })).toBe(ending);
				return new Response(opening + themedHead + ending, {
					headers: { 'content-type': 'text/html' }
				});
			});
			const response = await hooks.handle({ event: request, resolve });
			const html = await response.text();
			expect(html.match(/<style>/g)).toHaveLength(1);
			expect(html).not.toContain(sentinel);
			expect(html).not.toContain('/public/site.svg');
			expect(html).not.toContain('Replacement');
			expect(html).not.toContain('#abc');
			expect(html).not.toContain('--directory-');
			expect(ready.directory.currentSnapshot).toHaveBeenCalledOnce();
			expect(request.locals.snapshot).toBe(captured);
			expect(JSON.stringify(captured)).toBe(before);
			expect(mocks.load).not.toHaveBeenCalled();
			expect(mocks.prepare).not.toHaveBeenCalled();
			expect(mocks.path).not.toHaveBeenCalled();
			if (strategy !== 'none') {
				expect(authTransform).toHaveBeenCalledTimes(3);
				expect(authTransform.mock.calls[1]?.[0].html).toContain(
					themeStyleTag(captured.display.appearance)
				);
			}
		}
	);

	it('captures exactly once per request so nested loaders keep the original snapshot after publication', async () => {
		const initial = snapshot('Initial');
		const replacement = snapshot('Replacement');
		let published = initial;
		const directory = {
			currentSnapshot: vi.fn(() => published),
			reload: vi.fn<Directory['reload']>(),
			stop: vi.fn()
		};
		const app = {
			directory,
			publicDir: '/mounted/public',
			authentication: undefined,
			stop: vi.fn<Application['stop']>()
		};
		mocks.boot.mockResolvedValueOnce(app);
		const hooks = await import('./hooks.server.js');
		await hooks.init();
		const capturedPaths: string[] = [];
		const resolve = vi.fn<Resolve>().mockImplementation(async (event) => {
			const parent = async () => {
				const captured = event.locals.snapshot;
				capturedPaths.push(event.locals.publicDir);
				published = replacement;
				return captured.display.site.title;
			};
			const first = await parent();
			const second = event.locals.snapshot.display.site.title;
			capturedPaths.push(event.locals.publicDir);
			return Response.json({ first, second });
		});
		const firstEvent = event();
		const first = await hooks.handle({ event: firstEvent, resolve });
		expect(directory.currentSnapshot).toHaveBeenCalledOnce();
		expect(firstEvent.locals.snapshot).toBe(initial);
		expect(firstEvent.locals.authentication).toBeUndefined();
		expect(firstEvent.locals.session).toBeNull();
		expect(await firstEvent.locals.auth()).toBeNull();
		expect(resolve.mock.calls[0]?.[0].locals).toBe(firstEvent.locals);
		const body = await first.text();
		expect(JSON.parse(body)).toEqual({ first: 'Initial', second: 'Initial' });
		expect(body).not.toContain(sentinel);
		expect(body).not.toContain('configuration');
		expect(body).not.toContain('auth');
		expect(body).not.toContain(app.publicDir);
		expect(capturedPaths).toEqual([app.publicDir, app.publicDir]);
		const secondEvent = event();
		const second = await hooks.handle({ event: secondEvent, resolve });
		expect(directory.currentSnapshot).toHaveBeenCalledTimes(2);
		expect(secondEvent.locals.snapshot).toBe(replacement);
		expect(await second.json()).toEqual({ first: 'Replacement', second: 'Replacement' });
		expect(capturedPaths).toEqual(Array<string>(4).fill(app.publicDir));
		expect(mocks.boot).toHaveBeenCalledOnce();
		expect(mocks.path).not.toHaveBeenCalled();
		expect(mocks.load).not.toHaveBeenCalled();
		expect(mocks.prepare).not.toHaveBeenCalled();
		expect(directory.reload).not.toHaveBeenCalled();
	});
});
