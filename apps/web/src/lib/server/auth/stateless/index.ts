import { randomBytes } from 'node:crypto';
import { betterAuth, type BetterAuthOptions } from 'better-auth/minimal';
import type { DirectoryAuth } from '@directory/config/types';
import { logger } from '../../logger.js';
import { buildAuthOptions } from './providers.js';
import { CLIENT_ADDRESS_HEADER } from '../request.js';

const WEEK_SECONDS = 7 * 24 * 60 * 60;

export interface DirectorySession {
	user: { name: string };
	expires: string;
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
