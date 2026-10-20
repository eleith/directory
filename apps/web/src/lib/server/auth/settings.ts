import type { ConfigEnvironment } from '@directory/config/types';

export type AuthSetting =
	| 'AUTH_SECRET'
	| 'ORIGIN'
	| 'AUTH_URL'
	| 'NEXTAUTH_URL'
	| 'AUTH_REDIRECT_PROXY_URL';

export class AuthSettingsError extends Error {
	readonly setting: AuthSetting;

	constructor(setting: AuthSetting) {
		super('Authentication configuration invalid.');
		this.setting = setting;
	}
}

export interface AuthSettings {
	readonly secret: string;
	readonly origin: string;
}

export function requireAuthSettings(env: ConfigEnvironment): AuthSettings {
	const secret = env.AUTH_SECRET;
	if (!secret || secret.length < 32) throw new AuthSettingsError('AUTH_SECRET');
	const origin = fixedOrigin(env.ORIGIN, 'ORIGIN');
	if (fixedOrigin(env.AUTH_URL, 'AUTH_URL') !== origin) {
		throw new AuthSettingsError('AUTH_URL');
	}
	if (env.NEXTAUTH_URL !== undefined && fixedOrigin(env.NEXTAUTH_URL, 'NEXTAUTH_URL') !== origin) {
		throw new AuthSettingsError('NEXTAUTH_URL');
	}
	if (env.AUTH_REDIRECT_PROXY_URL) throw new AuthSettingsError('AUTH_REDIRECT_PROXY_URL');
	return { secret, origin };
}

function fixedOrigin(value: string | undefined, setting: AuthSetting): string {
	const url = parseUrl(value, setting);
	if (value !== url.origin || (url.protocol === 'http:' && url.hostname !== 'localhost')) {
		throw new AuthSettingsError(setting);
	}
	return url.origin;
}

function parseUrl(value: string | undefined, setting: AuthSetting): URL {
	try {
		const url = new URL(value ?? '');
		if (url.protocol === 'http:' || url.protocol === 'https:') return url;
	} catch {
		// Configuration values must not appear in startup errors.
	}
	throw new AuthSettingsError(setting);
}
