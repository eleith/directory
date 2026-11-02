import { beforeEach, expect, it, vi } from 'vitest';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { protectAuthRequest, requireSignIn, type AccessPolicy } from './access.js';
import { logger } from '../logger.js';

vi.mock('../logger.js', () => ({ logger: { error: vi.fn() } }));

const origin = 'https://directory.example';
const policy: AccessPolicy = { origin, strategy: 'credentials' };
const session = { user: { name: 'Directory' }, expires: '2030-01-01T00:00:00.000Z' };
type Resolve = Parameters<Handle>[0]['resolve'];
type RequestOptions = {
	method?: string;
	headers?: Record<string, string>;
	routeId?: string | null;
	data?: boolean;
};

beforeEach(() => vi.clearAllMocks());

function requestFor(path = '/', options: RequestOptions = {}) {
	const url = new URL(path, origin);
	const routeId = options.routeId === undefined ? '/(protected)' : options.routeId;
	const event = {
		url,
		request: new Request(url, {
			method: options.method ?? 'GET',
			headers: { accept: 'text/html', ...options.headers }
		}),
		route: { id: routeId },
		isDataRequest: options.data ?? false,
		locals: { auth: vi.fn<App.Locals['auth']>().mockResolvedValue(null), session: null }
	} as unknown as RequestEvent;
	const resolve = vi.fn<Resolve>().mockResolvedValue(new Response('private-content'));
	return { event, resolve };
}

it.each([
	['/(public)', 200],
	['/(public)/public/[...file]', 200],
	['/(publicity)/future', 303],
	['/(protected)', 303],
	['/(protected)/(endpoints)', 401],
	['/(protected)/(endpoints)/bookmarks/[id]/logo', 401],
	['/(protected)/(endpoints-other)/future', 303],
	[null, 303]
] as const)('uses matched route-group boundaries for %s', async (routeId, status) => {
	const input = requestFor('/future', { routeId });
	const response = await requireSignIn(input, policy);
	expect(response.status).toBe(status);
	if (status === 200) expect(input.event.locals.auth).not.toHaveBeenCalled();
	else expect(input.resolve).not.toHaveBeenCalled();
});

it.each<RequestOptions>([
	{ method: 'GET', data: true },
	{ method: 'GET', headers: { accept: 'application/json' } },
	{ method: 'GET', headers: { accept: 'text/html;q=0' } },
	{ method: 'HEAD' },
	{ method: 'POST', headers: { origin } }
])('denies private non-navigation requests: %j', async (options) => {
	const input = requestFor('/private', options);
	const response = await requireSignIn(input, policy);
	expect(response.status).toBe(401);
	expect(input.resolve).not.toHaveBeenCalled();
});

it('redirects signed-out HTML navigation back to its local destination', async () => {
	const response = await requireSignIn(requestFor('/private?q=one'), policy);
	const location = new URL(response.headers.get('location')!, origin);
	expect(response.status).toBe(303);
	expect(location.origin).toBe(origin);
	expect(location.pathname).toBe('/signin');
	expect(location.searchParams.get('callbackUrl')).toBe('/private?q=one');
});

it('allows an authenticated request and captures its session for the private UI', async () => {
	const input = requestFor('/bookmarks/photos/logo', {
		routeId: '/(protected)/(endpoints)/bookmarks/[id]/logo'
	});
	vi.mocked(input.event.locals.auth).mockResolvedValue(session);
	expect((await requireSignIn(input, policy)).status).toBe(200);
	expect(input.event.locals.session).toBe(session);
});

it('fails closed on a session-reader failure without forwarding its raw cause', async () => {
	const input = requestFor('/');
	const sentinel = 'private-session-token';
	vi.mocked(input.event.locals.auth).mockRejectedValue(new Error(sentinel));
	const response = await requireSignIn(input, policy);
	expect(response.status).toBe(401);
	expect(input.resolve).not.toHaveBeenCalled();
	expect(await response.text()).not.toContain(sentinel);
	expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(sentinel);
});

it('rejects either inconsistent request origin before resolving a route', async () => {
	for (const replaceRequest of [false, true]) {
		const input = requestFor('/');
		const foreign = new URL('https://another.example/');
		if (replaceRequest) input.event.request = new Request(foreign);
		else input.event.url = foreign;
		expect((await protectAuthRequest(input, policy)).status).toBe(403);
		expect(input.resolve).not.toHaveBeenCalled();
	}
});

it.each([undefined, 'null', 'https://another.example'])('rejects POST origin %s', async (value) => {
	const input = requestFor('/signin', {
		method: 'POST',
		headers: value === undefined ? {} : { origin: value }
	});
	expect((await protectAuthRequest(input, policy)).status).toBe(403);
	expect(input.resolve).not.toHaveBeenCalled();
});

it.each([
	'/auth/sign-in/credentials',
	'/auth/sign-in/social',
	'/auth/get-session',
	'/auth/sign-out'
])('keeps native auth endpoints private to the form wrappers: %s', async (path) => {
	const input = requestFor(path, { method: 'POST', headers: { origin } });
	expect((await protectAuthRequest(input, policy)).status).toBe(404);
	expect(input.resolve).not.toHaveBeenCalled();
});

it('permits only a configured OIDC GET callback, not data requests or POSTs', async () => {
	for (const [strategy, method, data, status] of [
		['oidc', 'GET', false, 200],
		['credentials', 'GET', false, 404],
		['oidc', 'GET', true, 404],
		['oidc', 'POST', false, 404]
	] as const) {
		const input = requestFor('/auth/callback/oidc', {
			method,
			data,
			headers: { origin: method === 'GET' ? 'https://identity.example' : origin }
		});
		expect((await protectAuthRequest(input, { origin, strategy })).status).toBe(status);
	}
});

it.each(['credentials', 'private-library-error'])('sanitizes sign-in errors: %s', async (code) => {
	const input = requestFor('/signin');
	input.resolve.mockResolvedValue(
		Response.redirect(`${origin}/signin?callbackUrl=%2Fsafe&error=${code}&token=private-token`, 302)
	);
	const response = await protectAuthRequest(input, policy);
	const location = new URL(response.headers.get('location')!, origin);
	expect(location.searchParams.get('callbackUrl')).toBe('/safe');
	expect(location.searchParams.get('error')).toBe(
		code === 'credentials' ? 'credentials' : 'signin'
	);
	expect(location.searchParams.has('token')).toBe(false);
	expect(response.headers.get('cache-control')).toBe('private, no-store');
});

it('preserves all response cookies when applying private caching', async () => {
	const input = requestFor('/signin');
	const headers = new Headers();
	headers.append('set-cookie', 'one=opaque; Path=/; HttpOnly');
	headers.append('set-cookie', 'two=opaque; Path=/; HttpOnly');
	input.resolve.mockResolvedValue(new Response(null, { headers }));
	const response = await protectAuthRequest(input, policy);
	expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
	expect(response.headers.get('cache-control')).toBe('private, no-store');
});

it('fails closed when a downstream auth request throws, without exposing its cause', async () => {
	const input = requestFor('/signin');
	const sentinel = 'private-auth-token';
	input.resolve.mockRejectedValue(new Error(sentinel));
	const response = await protectAuthRequest(input, policy);
	expect(response.status).toBe(500);
	expect(await response.text()).not.toContain(sentinel);
	expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(sentinel);
});
