import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Resolve core through the SDK that owns it, rather than add a test dependency
// or reproduce Auth.js's encrypted JWT format in this fixture.
const requireSdk = createRequire(import.meta.resolve('@auth/sveltekit'));
const jwtUrl = pathToFileURL(requireSdk.resolve('@auth/core/jwt')).href;
interface JwtModule {
	encode(options: {
		secret: string;
		salt: string;
		token: Record<string, unknown>;
		maxAge: number;
	}): Promise<string>;
	decode(options: {
		secret: string;
		salt: string;
		token: string;
	}): Promise<{ iat: number; exp: number } | null>;
}

export async function readSession(secret: string, name: string, token: string) {
	const jwt = (await import(jwtUrl)) as JwtModule;
	return jwt.decode({ secret, salt: name, token });
}

export async function expiredSession(secret: string, name: string): Promise<string> {
	const jwt = (await import(jwtUrl)) as JwtModule;
	return jwt.encode({ secret, salt: name, token: { sub: 'c6-expired-session' }, maxAge: -3_600 });
}
