import { randomBytes } from 'node:crypto';
import { betterAuth, type BetterAuthOptions } from 'better-auth/minimal';
import { isAuthPath } from 'better-auth/svelte-kit';
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { DirectoryAuth } from '@directory/config/types';
import { logger } from '../logger.js';
import { protectAuthRequest, requireSignIn } from './access.js';
import { signInAction, signOutAction } from './actions.js';
import { buildAuthOptions } from './providers.js';
import { authenticationHeaders, CLIENT_ADDRESS_HEADER } from './request.js';

export { localRedirect } from './redirect.js';

const WEEK_SECONDS = 7 * 24 * 60 * 60;

export interface DirectorySession {
	user: { name: string };
	expires: string;
}

export interface Authentication {
	readonly strategy: 'credentials' | 'oidc';
	readonly handle: Handle;
	signIn(event: RequestEvent): Promise<void>;
	signOut(event: RequestEvent): Promise<void>;
}

export function createAuthentication(config: DirectoryAuth & { origin: string }): Authentication {
	const { origin } = config;
	const auth = createAuth(config, origin)!;
	const strategy = config.credentials ? 'credentials' : 'oidc';
	const policy = { origin, strategy } as const;
	const nativeHandle: Handle = ({ event, resolve }) => {
		event.locals.auth = createSessionReader(auth, event.request.headers);
		if (!isAuthPath(event.request.url, auth.options)) return resolve(event);
		// protectAuthRequest has already checked both request and Kit origins.
		return auth.handler(new Request(event.request, { headers: authenticationHeaders(event) }));
	};
	return {
		strategy,
		handle: sequence(
			(input) => protectAuthRequest(input, policy),
			nativeHandle,
			(input) => requireSignIn(input, policy)
		),
		signIn: (event) => signInAction(event, auth, origin, strategy),
		signOut: (event) => signOutAction(event, auth, origin)
	};
}

export function createAuth(config: DirectoryAuth | undefined, origin: string) {
	if (!config) return undefined;
	const secret = config.secret ?? randomBytes(32).toString('base64');
	if (secret.length < 32) {
		throw new Error('Authentication secret must contain at least 32 characters.');
	}

	return betterAuth<BetterAuthOptions & { baseURL: string }>({
		secret,
		// Native environment keyrings must not override YAML or defeat secret rotation.
		secrets: [{ version: 1, value: secret }],
		baseURL: origin,
		basePath: '/auth',
		trustedOrigins: [origin],
		telemetry: { enabled: false },
		session: {
			expiresIn: WEEK_SECONDS,
			disableSessionRefresh: true,
			cookieCache: { refreshCache: false }
		},
		account: {
			storeAccountCookie: false,
			accountLinking: { enabled: false }
		},
		advanced: {
			disableOriginCheck: false,
			ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] }
		},
		...buildAuthOptions(config, origin),
		logger: {
			log: (level) => logger[level]('Authentication event (better_auth).')
		}
	});
}

export type Auth = NonNullable<ReturnType<typeof createAuth>>;

export function createSessionReader(auth: Auth | undefined, headers: Headers) {
	async function readSession(): Promise<DirectorySession | null> {
		if (!auth) return null;
		const data = await auth.api.getSession({ headers });
		if (!data) return null;
		return {
			user: { name: data.user.name },
			expires: data.session.expiresAt.toISOString()
		};
	}

	let session: Promise<DirectorySession | null> | undefined;
	return () => (session ??= readSession());
}
