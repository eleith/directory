import Credentials from '@auth/sveltekit/providers/credentials';
import type { SvelteKitAuthConfig } from '@auth/sveltekit';
import type { DirectoryAuth } from '@directory/config/types';
import { verifyCredentials } from './credentials.js';

export { verifyCredentials } from './credentials.js';

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
