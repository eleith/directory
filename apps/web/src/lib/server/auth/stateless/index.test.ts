import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isRedirect, type RequestEvent } from '@sveltejs/kit';
import { setRequestCookie } from 'better-auth/cookies';
import type { DirectoryAuth } from '@directory/config/types';
import { signInAction, signOutAction } from './actions.js';
import { createAuth, createSessionReader, type Auth } from './index.js';

vi.hoisted(() => vi.stubEnv('NODE_ENV', 'production'));
vi.mock('../../logger.js', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

const origin = 'https://directory.example';
const secret = 'configured-session-secret-with-at-least-32-characters';
const credentials = { username: 'family', password: 'correct café ☕' };
const config = { secret, credentials };
let cookieHeaders: Headers;
let client = 0;
let address: string;

beforeEach(() => {
	vi.stubEnv('NODE_ENV', 'production');
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
	cookieHeaders = new Headers();
	address = `192.0.2.${++client}`;
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

function authentication(settings: DirectoryAuth = config): Auth {
	const auth = createAuth(settings, origin);
	if (!auth) throw new Error('Expected enabled authentication.');
	return auth;
}

function formEvent(
	path: string,
	fields: Record<string, string>,
	browserOrigin = origin
): RequestEvent {
	const headers = new Headers(cookieHeaders);
	headers.set('origin', browserOrigin);
	const request = new Request(new URL(path, origin), {
		method: 'POST',
		headers,
		body: new URLSearchParams(fields)
	});
	return {
		request,
		url: new URL(request.url),
		getClientAddress: () => address,
		cookies: {
			set(name: string, value: string) {
				// Model only Kit forwarding cookies into the next browser request.
				setRequestCookie(cookieHeaders, name, value);
			}
		}
	} as unknown as RequestEvent;
}

async function destination(action: Promise<void>): Promise<URL> {
	try {
		await action;
	} catch (result) {
		if (!isRedirect(result)) throw result;
		expect(result.status).toBe(303);
		return new URL(result.location, origin);
	}
	throw new Error('Expected an action redirect.');
}

function signIn(auth: Auth, fields = credentials) {
	return signInAction(formEvent('/signin', fields), auth, origin, 'credentials');
}

it('keeps native form login/logout local and propagates their session cookies', async () => {
	const auth = authentication();
	const login = await destination(
		signInAction(
			formEvent('/signin', {
				...credentials,
				redirectTo: 'https://another.example/private',
				providerId: 'unconfigured-provider'
			}),
			auth,
			origin,
			'credentials'
		)
	);
	expect(login.origin).toBe(origin);
	expect(login.pathname).toBe('/');
	expect(await createSessionReader(auth, cookieHeaders)()).not.toBeNull();

	const logout = await destination(
		signOutAction(formEvent('/?/signout', { redirectTo: '/signin' }), auth, origin)
	);
	expect(logout.pathname).toBe('/signin');
	expect(await createSessionReader(auth, cookieHeaders)()).toBeNull();
});

it('rejects wrong credentials without creating a session', async () => {
	const auth = authentication();
	const location = await destination(signIn(auth, { ...credentials, password: 'incorrect' }));
	expect(location.pathname).toBe('/signin');
	expect(location.searchParams.has('error')).toBe(true);
	expect(await createSessionReader(auth, cookieHeaders)()).toBeNull();
});

it('rejects a cross-origin native form before it can sign in', async () => {
	const auth = authentication();
	await expect(
		signInAction(
			formEvent('/signin', credentials, 'https://another.example'),
			auth,
			origin,
			'credentials'
		)
	).rejects.toMatchObject({ status: 403 });
	expect(await createSessionReader(auth, cookieHeaders)()).toBeNull();
});

it('expires an active session at the original seven-day deadline without renewal', async () => {
	const auth = authentication();
	await destination(signIn(auth));
	const initial = await createSessionReader(auth, cookieHeaders)();
	expect(initial?.expires).toBe('2030-01-08T12:00:00.000Z');

	vi.setSystemTime(new Date('2030-01-08T11:00:00Z'));
	expect((await createSessionReader(auth, cookieHeaders)())?.expires).toBe(initial?.expires);
	vi.setSystemTime(new Date('2030-01-08T12:00:01Z'));
	expect(await createSessionReader(auth, cookieHeaders)()).toBeNull();
});

it('keeps YAML keys authoritative across restarts and invalidates sessions on rotation', async () => {
	vi.stubEnv('BETTER_AUTH_SECRETS', '99:ambient-session-secret-that-must-not-override-yaml');
	await destination(signIn(authentication()));

	vi.stubEnv('BETTER_AUTH_SECRETS', '99:another-ambient-secret-that-must-not-override-yaml');
	expect(await createSessionReader(authentication(), cookieHeaders)()).not.toBeNull();
	const rotated = authentication({
		...config,
		secret: 'replacement-session-secret-with-at-least-32-characters'
	});
	expect(await createSessionReader(rotated, cookieHeaders)()).toBeNull();
});

it('generates a process-local key when omitted, without inheriting ambient auth secrets', async () => {
	vi.stubEnv('BETTER_AUTH_SECRET', secret);
	vi.stubEnv('AUTH_SECRET', secret);
	const auth = authentication({ credentials });
	await destination(signIn(auth));
	expect(await createSessionReader(auth, cookieHeaders)()).not.toBeNull();
	expect(await createSessionReader(authentication({ credentials }), cookieHeaders)()).toBeNull();
});

it('leaves public mode independent of authentication configuration', async () => {
	vi.stubEnv('BETTER_AUTH_SECRET', 'invalid');
	expect(createAuth(undefined, '')).toBeUndefined();
	expect(await createSessionReader(undefined, new Headers())()).toBeNull();
});

it('starts OIDC through the configured provider and existing callback without a browser SDK', async () => {
	const issuer = 'https://identity.example';
	vi.stubGlobal(
		'fetch',
		vi.fn(async () =>
			Response.json({
				issuer,
				authorization_endpoint: `${issuer}/authorize`,
				token_endpoint: `${issuer}/token`,
				userinfo_endpoint: `${issuer}/userinfo`,
				jwks_uri: `${issuer}/jwks`,
				id_token_signing_alg_values_supported: ['RS256']
			})
		)
	);
	const auth = authentication({
		secret,
		oidc: { issuer, client_id: 'directory', client_secret: 'configured-client-secret' }
	});
	const location = await destination(
		signInAction(
			formEvent('/signin', { redirectTo: '/', provider: 'unconfigured-provider' }),
			auth,
			origin,
			'oidc'
		)
	);
	expect(location.origin).toBe(issuer);
	expect(location.pathname).toBe('/authorize');
	expect(location.searchParams.get('redirect_uri')).toBe(`${origin}/auth/callback/oidc`);
	// Callback completion remains covered by the existing local-issuer browser flow at cutover.
	expect(cookieHeaders.has('cookie')).toBe(true);
});
