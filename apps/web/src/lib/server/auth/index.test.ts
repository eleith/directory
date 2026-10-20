import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect, redirect, type Handle, type RequestEvent } from '@sveltejs/kit';
import type { Session, SvelteKitAuthConfig } from '@auth/sveltekit';
import { createAuthentication } from './index.js';

const mocks = vi.hoisted(() => ({
	constructor: vi.fn(),
	sequence: vi.fn(),
	handle: vi.fn(),
	signIn: vi.fn(),
	signOut: vi.fn(),
	session: vi.fn(),
	resolve: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn()
}));

vi.mock('@auth/sveltekit', () => ({
	SvelteKitAuth: mocks.constructor
}));
vi.mock('../logger.js', () => ({ logger: { error: mocks.logError, warn: mocks.logWarn } }));
// Native sequence needs Kit's request store; real HTTP tests exercise that integration.
vi.mock('@sveltejs/kit/hooks', () => ({ sequence: mocks.sequence }));

const origin = 'https://directory.example';
const env = { ORIGIN: origin, AUTH_URL: origin, AUTH_SECRET: 'x'.repeat(32) };
const credentials = { username: 'family', password: 'private-password' };
const signedIn: Session = { user: { name: 'Directory' }, expires: '2030-01-01T00:00:00.000Z' };

function eventFor(
	path = '/',
	options: { method?: string; headers?: HeadersInit; body?: BodyInit; data?: boolean } = {}
): RequestEvent {
	const method = options.method ?? 'GET';
	const headers = new Headers({ accept: 'text/html', ...options.headers });
	const request = new Request(new URL(path, origin), {
		method,
		headers,
		...(options.body === undefined ? {} : { body: options.body })
	});
	return {
		url: new URL(request.url),
		request,
		locals: {},
		route: {
			id: /^\/bookmarks\/[^/]+\/logo$/.test(new URL(request.url).pathname)
				? '/bookmarks/[id]/logo'
				: null
		},
		isDataRequest: options.data ?? false,
		cookies: { set: vi.fn(), get: vi.fn() }
	} as unknown as RequestEvent;
}

function authenticate() {
	return createAuthentication({ credentials }, env);
}

async function responseFor(event: RequestEvent) {
	return authenticate().handle({ event, resolve: mocks.resolve });
}

function authJsConfig(): SvelteKitAuthConfig {
	return mocks.constructor.mock.calls[0]?.[0] as SvelteKitAuthConfig;
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.sequence.mockImplementation((...handlers: Handle[]): Handle => {
		return ({ event, resolve }) => {
			const run = (index: number, current: RequestEvent): ReturnType<Handle> => {
				const handler = handlers[index];
				return handler
					? handler({ event: current, resolve: (next) => Promise.resolve(run(index + 1, next)) })
					: resolve(current);
			};
			return run(0, event);
		};
	});
	mocks.constructor.mockReturnValue({
		handle: mocks.handle,
		signIn: mocks.signIn,
		signOut: mocks.signOut
	});
	mocks.handle.mockImplementation(async ({ event, resolve }) => {
		event.locals.auth = mocks.session;
		if (event.url.pathname === '/auth/callback/oidc') {
			return new Response(null, { status: 302, headers: { location: '/' } });
		}
		return resolve(event);
	});
	mocks.session.mockResolvedValue(null);
	mocks.resolve.mockResolvedValue(new Response('private-page'));
});

describe('bookmark logo API access', () => {
	it.each(['GET', 'HEAD'])('requires a session for %s even with HTML Accept', async (method) => {
		for (const path of ['/bookmarks/photos/logo', '/bookmarks/missing/logo']) {
			const response = await responseFor(eventFor(path, { method }));
			expect(response.status).toBe(401);
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		}
		expect(mocks.resolve).not.toHaveBeenCalled();
	});

	it.each(['GET', 'HEAD'])(
		'uses the matched logo API route for encoded %s aliases',
		async (method) => {
			for (const path of [
				'/%62ookmarks/photos/logo',
				'/bookmarks/%70hotos/logo',
				'/bookmarks/photos/%6cogo'
			]) {
				const event = eventFor(path, { method });
				event.route.id = '/bookmarks/[id]/logo';
				expect((await responseFor(event)).status).toBe(401);
				expect(mocks.resolve).not.toHaveBeenCalled();
			}
		}
	);

	it('lets an authenticated request reach the prepared SVG route', async () => {
		mocks.session.mockResolvedValueOnce(signedIn);
		expect((await responseFor(eventFor('/bookmarks/photos/logo'))).status).toBe(200);
		expect(mocks.resolve).toHaveBeenCalledOnce();
	});
});

describe('boot factory', () => {
	it('constructs one SDK instance and seven-day native JWT pipeline per application', async () => {
		const authentication = authenticate();
		expect(authentication.strategy).toBe('credentials');
		expect(authJsConfig()).toMatchObject({
			secret: env.AUTH_SECRET,
			trustHost: true,
			basePath: '/auth',
			redirectProxyUrl: '',
			session: { strategy: 'jwt', maxAge: 604800 },
			pages: { signIn: '/signin', error: '/signin' }
		});
		for (let index = 0; index < 2; index++) {
			await authentication.handle({ event: eventFor('/signin'), resolve: mocks.resolve });
		}
		expect(mocks.constructor).toHaveBeenCalledTimes(1);
		expect(mocks.sequence).toHaveBeenCalledTimes(1);
	});

	it('does not construct an SDK on invalid enabled settings', () => {
		expect(() => createAuthentication({ credentials }, {})).toThrow();
		expect(mocks.constructor).not.toHaveBeenCalled();
	});

	it('pins redirect callbacks and does not emit raw SDK diagnostics', async () => {
		authenticate();
		const callback = authJsConfig().callbacks?.redirect;
		expect(await callback?.({ url: 'https://evil.example/token', baseUrl: origin })).toBe(
			`${origin}/`
		);
		expect(await callback?.({ url: '/safe?a=1', baseUrl: 'https://evil.example' })).toBe(
			`${origin}/safe?a=1`
		);
		const authJsLogger = authJsConfig().logger;
		authJsLogger?.error?.(new Error('secret/token/issuer sentinel'));
		authJsLogger?.warn?.('env-url-basepath-redundant');
		expect(mocks.logWarn).not.toHaveBeenCalled();
		authJsLogger?.warn?.('env-url-basepath-mismatch');
		authJsLogger?.debug?.('sensitive debug', { token: 'raw-token' });
		expect(mocks.logError.mock.calls).toEqual([['Auth.js failed (authjs_error).']]);
		expect(mocks.logWarn.mock.calls).toEqual([['Auth.js warning (authjs_warning).']]);
	});
});

describe('whole-directory gate', () => {
	it.each([
		['/private?tag=1', '/signin?callbackUrl=%2Fprivate%3Ftag%3D1'],
		['/bookmarks', '/signin?callbackUrl=%2Fbookmarks'],
		['/bookmarks/photos', '/signin?callbackUrl=%2Fbookmarks%2Fphotos'],
		['/bookmarks/photos/other', '/signin?callbackUrl=%2Fbookmarks%2Fphotos%2Fother']
	])(
		'redirects only unauthenticated HTML navigation with a local callback: %s',
		async (path, location) => {
			const response = await responseFor(eventFor(path));
			expect(response.status).toBe(303);
			expect(response.headers.get('location')).toBe(location);
			expect(await response.text()).not.toContain('private-page');
			expect(mocks.resolve).not.toHaveBeenCalled();
		}
	);

	it.each([
		['/', { data: true }],
		['/private', { headers: { accept: 'application/json' } }],
		['/private', { headers: { accept: 'text/html;q=0' } }],
		['/private', { headers: { accept: '*/*' } }],
		['/private', { method: 'HEAD' }],
		['/private', { method: 'POST', headers: { origin } }],
		['/private', { method: 'OPTIONS' }],
		['/public/private.svg', { headers: { accept: 'image/svg+xml' } }],
		['/unknown', { headers: { accept: '' } }]
	])('denies private non-navigation requests: %s %j', async (path, options) => {
		const response = await responseFor(eventFor(path, options));
		expect(response.status).toBe(401);
		expect(await response.text()).toBe('Access denied');
		expect(mocks.resolve).not.toHaveBeenCalled();
	});

	it.each([
		['text/html;q=0.000', 401],
		['text/html; q=0.0 ; charset=utf-8', 401],
		['text/html;q=0.5', 303],
		['text/plain, text/html; charset=utf-8', 303],
		['text/html;q=0, text/html;q=0.8', 303],
		['text/html;q=1, application/json;q=0', 401]
	])('preserves navigation Accept policy for %s', async (accept, status) => {
		const response = await responseFor(eventFor('/private', { headers: { accept } }));
		expect(response.status).toBe(status);
		expect(mocks.resolve).not.toHaveBeenCalled();
	});

	it.each([
		['/signin', 'GET', false],
		['/signin', 'GET', true],
		['/signin', 'POST', false],
		['/healthz', 'GET', false],
		['/healthz', 'HEAD', false],
		['/favicon.svg', 'GET', false],
		['/_app/immutable/assets/app.hash.css', 'GET', false]
	])('allows only documented public resources: %s %s', async (path, method, data) => {
		const response = await responseFor(eventFor(path, { method, data, headers: { origin } }));
		expect(response.status).toBe(200);
		expect(mocks.resolve).toHaveBeenCalledOnce();
	});

	it.each([
		'/auth',
		'/auth/',
		'/auth/session',
		'/auth/providers',
		'/auth/csrf',
		'/auth/signout',
		'/auth/callback/credentials',
		'/auth/signin/oidc',
		'/auth/error'
	])('blocks unused raw SDK route %s even with a session', async (path) => {
		mocks.session.mockResolvedValue(signedIn);
		for (const method of ['GET', 'POST']) {
			const response = await responseFor(eventFor(path, { method, headers: { origin } }));
			expect(response.status).toBe(404);
		}
		expect(mocks.handle).not.toHaveBeenCalled();
		expect(mocks.resolve).not.toHaveBeenCalled();
	});

	it('permits only the configured OIDC GET callback, including cross-site navigation', async () => {
		const authentication = createAuthentication(
			{
				oidc: {
					issuer: 'https://issuer.example',
					client_id: 'client',
					client_secret: 'secret'
				}
			},
			env
		);
		const callback = eventFor('/auth/callback/oidc?state=test', {
			headers: { origin: 'https://issuer.example' }
		});
		expect((await authentication.handle({ event: callback, resolve: mocks.resolve })).status).toBe(
			302
		);
		expect(mocks.resolve).not.toHaveBeenCalled();
		expect((await responseFor(callback)).status).toBe(404);
		const post = eventFor('/auth/callback/oidc', { method: 'POST', headers: { origin } });
		expect((await authentication.handle({ event: post, resolve: mocks.resolve })).status).toBe(404);
		const data = eventFor('/auth/callback/oidc', { data: true });
		expect((await authentication.handle({ event: data, resolve: mocks.resolve })).status).toBe(404);
	});

	it('caches the native SDK session for the root UI without exposing it in data', async () => {
		mocks.session.mockResolvedValue(signedIn);
		const event = eventFor('/');
		expect((await responseFor(event)).status).toBe(200);
		expect(event.locals.session).toBe(signedIn);
		expect(mocks.session).toHaveBeenCalledOnce();
	});

	it('does not authorize a session without a user', async () => {
		mocks.session.mockResolvedValue({ expires: '2099-01-01T00:00:00.000Z' });
		const response = await responseFor(eventFor('/__data.json', { data: true }));
		expect(response.status).toBe(401);
		expect(mocks.resolve).not.toHaveBeenCalled();
	});

	it('denies session errors even on the sign-in page, without logging causes', async () => {
		mocks.session.mockRejectedValue(new Error('token sentinel'));
		const response = await responseFor(eventFor('/signin'));
		expect(response.status).toBe(401);
		expect(mocks.resolve).not.toHaveBeenCalled();
		expect(mocks.logError).toHaveBeenCalledWith(
			'Authentication session failed (auth_session_failed).'
		);
	});

	it('adds private security headers to immutable SDK redirects', async () => {
		mocks.handle.mockResolvedValue(
			Response.redirect(`${origin}/signin?error=RawSDKCode&code=secret`, 302)
		);
		const response = await responseFor(eventFor('/signin'));
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(response.headers.get('location')).toBe('/signin?callbackUrl=%2F&error=signin');
	});

	it('preserves multiple native SDK cookie headers when adding security headers', async () => {
		const headers = new Headers({ location: '/' });
		headers.append('set-cookie', 'one=opaque; Path=/; HttpOnly');
		headers.append('set-cookie', 'two=opaque; Path=/; HttpOnly');
		mocks.handle.mockResolvedValue(new Response(null, { status: 302, headers }));
		const response = await responseFor(eventFor('/signin'));
		expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
	});

	it('preserves a safe callback while normalizing generic action-error redirects', async () => {
		mocks.handle.mockImplementation(() =>
			redirect(303, '/signin?callbackUrl=%2Fsafe&error=signin')
		);
		const response = await responseFor(eventFor('/signin'));
		expect(response.headers.get('location')).toBe('/signin?callbackUrl=%2Fsafe&error=signin');
	});

	it('denies unexpected SDK exceptions without returning private content or raw errors', async () => {
		mocks.handle.mockRejectedValue(new Error('raw token sentinel'));
		const response = await responseFor(eventFor('/signin'));
		expect(response.status).toBe(500);
		expect(await response.text()).toBe('Access denied');
		expect(mocks.resolve).not.toHaveBeenCalled();
	});
});

describe('trusted origin boundary', () => {
	it('rejects inconsistently constructed event and request origins before calling SDK', async () => {
		const event = eventFor('/');
		event.url = new URL('https://evil.example/');
		expect((await responseFor(event)).status).toBe(403);
		const other = eventFor('https://evil.example/');
		other.url = new URL(origin);
		expect((await responseFor(other)).status).toBe(403);
		expect(mocks.handle).not.toHaveBeenCalled();
	});

	it.each(['application/x-www-form-urlencoded', 'application/json', 'text/plain'])(
		'requires exact Origin for POST regardless of %s',
		async (contentType) => {
			for (const badOrigin of [undefined, 'null', 'https://evil.example', `${origin}/`]) {
				const response = await responseFor(
					eventFor('/signin', {
						method: 'POST',
						headers: {
							'content-type': contentType,
							...(badOrigin === undefined ? {} : { origin: badOrigin })
						},
						body: 'username=family'
					})
				);
				expect(response.status).toBe(403);
			}
			expect(mocks.handle).not.toHaveBeenCalled();
		}
	);

	it('passes the original Kit event and attacker headers directly to the native SDK', async () => {
		const event = eventFor('/signin', {
			headers: {
				host: 'evil.example',
				'x-forwarded-host': 'evil.example',
				'x-forwarded-proto': 'http',
				'x-forwarded-port': '80',
				forwarded: 'host=evil.example;proto=http',
				'x-auth-return-redirect': '1'
			}
		});
		const originalRequest = event.request;
		const originalHeaders = [...event.request.headers];
		await responseFor(event);
		const nativeEvent = mocks.handle.mock.calls[0]?.[0].event as RequestEvent;
		expect(nativeEvent).toBe(event);
		expect(nativeEvent.request).toBe(originalRequest);
		expect([...nativeEvent.request.headers]).toEqual(originalHeaders);
		expect(nativeEvent.url).toBe(event.url);
		expect(nativeEvent.cookies).toBe(event.cookies);
		expect(nativeEvent.locals).toBe(event.locals);
		expect(mocks.resolve.mock.calls[0]?.[0]).toBe(event);
		expect(event.cookies.set).not.toHaveBeenCalled();
	});
});

describe('native action wrappers', () => {
	function actionEvent(body: BodyInit, contentType = 'application/x-www-form-urlencoded') {
		return eventFor('/signin', {
			method: 'POST',
			headers: { origin, 'content-type': contentType },
			body
		});
	}

	it('selects configured credentials and allowlists the entire SDK action body', async () => {
		const body = new URLSearchParams({
			username: credentials.username,
			password: credentials.password,
			redirectTo: '/safe?q=1',
			providerId: 'evil',
			redirect: 'false',
			'authorizationParams-prompt': 'evil',
			token: 'secret'
		});
		const event = actionEvent(body);
		await authenticate().signIn(event);
		const normalized = mocks.signIn.mock.calls[0]?.[0] as RequestEvent;
		expect(Object.fromEntries(await normalized.request.formData())).toEqual({
			providerId: 'credentials',
			...credentials,
			redirectTo: '/safe?q=1'
		});
		expect(normalized.cookies).toBe(event.cookies);
		expect(await event.request.text()).toBe(body.toString());
	});

	it.each(['signIn', 'signOut'] as const)(
		'copies only the allowlisted %s body, preserving native Kit context and headers',
		async (kind) => {
			const event = eventFor('/signin', {
				method: 'POST',
				headers: {
					origin,
					'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
					'content-length': '16',
					host: 'evil.example',
					'x-forwarded-host': 'evil.example',
					'x-forwarded-proto': 'http',
					'x-forwarded-port': '80',
					forwarded: 'host=evil.example;proto=http',
					'x-auth-return-redirect': '1'
				},
				body: 'redirectTo=/safe'
			});
			const originalHeaders = [...event.request.headers];
			await authenticate()[kind](event);
			const formEvent = mocks[kind].mock.calls[0]?.[0] as RequestEvent;
			expect(formEvent).not.toBe(event);
			expect(formEvent.request).not.toBe(event.request);
			expect(formEvent.request.url).toBe(event.request.url);
			expect(formEvent.url).toBe(event.url);
			expect(formEvent.cookies).toBe(event.cookies);
			expect(formEvent.locals).toBe(event.locals);
			const expectedHeaders = new Headers(event.request.headers);
			expectedHeaders.set('content-type', 'application/x-www-form-urlencoded');
			expectedHeaders.delete('content-length');
			expect([...formEvent.request.headers]).toEqual([...expectedHeaders]);
			expect([...event.request.headers]).toEqual(originalHeaders);
		}
	);

	it('selects configured OIDC without forwarding credential or authorization overrides', async () => {
		const authentication = createAuthentication(
			{
				oidc: {
					issuer: 'https://issuer.example',
					client_id: 'client',
					client_secret: 'secret'
				}
			},
			env
		);
		await authentication.signIn(
			actionEvent(
				new URLSearchParams({
					...credentials,
					redirectTo: '//evil.example',
					providerId: 'credentials'
				})
			)
		);
		const normalized = mocks.signIn.mock.calls[0]?.[0] as RequestEvent;
		expect(Object.fromEntries(await normalized.request.formData())).toEqual({
			providerId: 'oidc',
			redirectTo: '/'
		});
	});

	it('sanitizes sign-out return paths and drops every other field', async () => {
		await authenticate().signOut(
			actionEvent(
				new URLSearchParams({
					redirectTo: 'https://evil.example/token',
					redirect: 'false',
					'authorizationParams-state': 'secret'
				})
			)
		);
		const normalized = mocks.signOut.mock.calls[0]?.[0] as RequestEvent;
		expect(Object.fromEntries(await normalized.request.formData())).toEqual({ redirectTo: '/' });
	});

	it('rejects duplicate fields rather than selecting an attacker-controlled occurrence', async () => {
		await authenticate().signIn(
			actionEvent(
				'username=family&username=evil&password=one&password=two&redirectTo=/one&redirectTo=/two'
			)
		);
		const normalized = mocks.signIn.mock.calls[0]?.[0] as RequestEvent;
		expect(Object.fromEntries(await normalized.request.formData())).toEqual({
			providerId: 'credentials',
			username: '',
			password: '',
			redirectTo: '/'
		});
	});

	it('does not stringify uploaded credential fields or accept an uploaded return path', async () => {
		const body = new FormData();
		body.set('username', new File(['family'], 'username.txt'));
		body.set('password', new File(['private-password'], 'password.txt'));
		body.set('redirectTo', new File(['/safe'], 'return.txt'));
		await authenticate().signIn(eventFor('/signin', { method: 'POST', headers: { origin }, body }));
		const normalized = mocks.signIn.mock.calls[0]?.[0] as RequestEvent;
		expect(Object.fromEntries(await normalized.request.formData())).toEqual({
			providerId: 'credentials',
			username: '',
			password: '',
			redirectTo: '/'
		});
	});

	it('preserves legitimate native Kit redirects and cookie context', async () => {
		mocks.signIn.mockImplementation(async (event: RequestEvent) => {
			event.cookies.set('native-session', 'opaque', { path: '/' });
			redirect(302, 'https://issuer.example/authorize?state=opaque');
		});
		const event = actionEvent('redirectTo=/safe');
		const result = await authenticate()
			.signIn(event)
			.catch((error: unknown) => error);
		expect(isRedirect(result) && result.location).toBe(
			'https://issuer.example/authorize?state=opaque'
		);
		expect(event.cookies.set).toHaveBeenCalledWith('native-session', 'opaque', { path: '/' });
	});

	it.each(['signIn', 'signOut'] as const)(
		'maps %s SDK failures to a generic safe redirect',
		async (kind) => {
			mocks[kind].mockRejectedValue(new Error('raw token / issuer URL sentinel'));
			const result = await authenticate()
				[kind](actionEvent('redirectTo=%2Fsafe'))
				.catch((error: unknown) => error);
			expect(isRedirect(result) && result.location).toBe(
				'/signin?callbackUrl=%2Fsafe&error=signin'
			);
			expect(mocks.logError.mock.calls).toEqual([
				['Authentication action failed (auth_action_failed).']
			]);
		}
	);

	it('sanitizes SDK error redirects while preserving safe form callback', async () => {
		mocks.signIn.mockImplementation(() =>
			redirect(302, `${origin}/signin?error=CredentialsSignin&code=raw`)
		);
		const result = await authenticate()
			.signIn(actionEvent('redirectTo=%2Fsafe'))
			.catch((error: unknown) => error);
		expect(isRedirect(result) && result.location).toBe('/signin?callbackUrl=%2Fsafe&error=signin');
	});

	it('handles malformed bodies generically and validates direct action invocation origins', async () => {
		let result = await authenticate()
			.signIn(actionEvent('{"token":"sentinel"}', 'application/json'))
			.catch((error: unknown) => error);
		expect(isRedirect(result) && result.location).toBe('/signin?callbackUrl=%2F&error=signin');
		result = await authenticate()
			.signOut(eventFor('/', { method: 'POST' }))
			.catch((error: unknown) => error);
		expect(isHttpError(result) && result.status).toBe(403);
		expect(mocks.signIn).not.toHaveBeenCalled();
		expect(mocks.signOut).not.toHaveBeenCalled();
	});
});
