import { createHash, timingSafeEqual } from 'node:crypto';
import Credentials from '@auth/sveltekit/providers/credentials';
import type { SvelteKitAuthConfig } from '@auth/sveltekit';
import type { DirectoryAuth } from '@directory/config/types';

type SharedCredentials = NonNullable<DirectoryAuth['credentials']>;

export function buildProviders(config: DirectoryAuth): SvelteKitAuthConfig['providers'] {
	if (config.credentials) {
		const credentials = { ...config.credentials };
		return [
			Credentials({
				name: 'Password',
				credentials: {
					username: { label: 'Username', type: 'text' },
					password: { label: 'Password', type: 'password' }
				},
				authorize: (submitted) => verifyCredentials(credentials, submitted)
			})
		];
	}
	return [
		{
			id: 'oidc',
			name: 'SSO',
			type: 'oidc',
			issuer: config.oidc.issuer,
			clientId: config.oidc.client_id,
			clientSecret: config.oidc.client_secret,
			checks: ['pkce', 'state', 'nonce']
		}
	];
}

export function verifyCredentials(
	configured: SharedCredentials,
	submitted: Partial<Record<string, unknown>> | undefined
): { id: string; name: string } | null {
	const username = typeof submitted?.username === 'string' ? submitted.username : '';
	const password = typeof submitted?.password === 'string' ? submitted.password : '';
	// Fixed-size digests allow both comparisons even when input lengths differ.
	const usernameMatches = secretEquals(username, configured.username);
	const passwordMatches = secretEquals(password, configured.password);
	return usernameMatches && passwordMatches ? { id: 'directory', name: 'Directory' } : null;
}

function secretEquals(left: string, right: string): boolean {
	return timingSafeEqual(digest(left), digest(right));
}

function digest(value: string): Buffer {
	return createHash('sha256').update(value).digest();
}
