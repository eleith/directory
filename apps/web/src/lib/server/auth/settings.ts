import type { ConfigEnvironment } from '@directory/config/types';

export interface AuthSettings {
	readonly secret: string;
	readonly origin: string;
}

export function requireAuthSettings(env: ConfigEnvironment): AuthSettings {
	const secret = env.AUTH_SECRET;
	if (!secret || secret.length < 32) throw new Error('Authentication configuration invalid.');
	const origin = fixedOrigin(env.ORIGIN);
	if (fixedOrigin(env.AUTH_URL) !== origin) {
		throw new Error('Authentication configuration invalid.');
	}
	if (env.NEXTAUTH_URL !== undefined && fixedOrigin(env.NEXTAUTH_URL) !== origin) {
		throw new Error('Authentication configuration invalid.');
	}
	if (env.AUTH_REDIRECT_PROXY_URL) throw new Error('Authentication configuration invalid.');
	return { secret, origin };
}

function fixedOrigin(value: string | undefined): string {
	const url = parseUrl(value);
	if (value !== url.origin || (url.protocol === 'http:' && url.hostname !== 'localhost')) {
		throw new Error('Authentication configuration invalid.');
	}
	return url.origin;
}

function parseUrl(value: string | undefined): URL {
	try {
		const url = new URL(value ?? '');
		if (url.protocol === 'http:' || url.protocol === 'https:') return url;
	} catch {
		// Configuration values must not appear in startup errors.
	}
	throw new Error('Authentication configuration invalid.');
}
