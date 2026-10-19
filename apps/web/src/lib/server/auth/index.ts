import { SvelteKitAuth, type SvelteKitAuthConfig } from '@auth/sveltekit';
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { ConfigEnvironment, DirectoryAuth } from '@directory/config/types';
import { logger } from '../logger.js';
import { protectAuthRequest, requireSignIn } from './access.js';
import { signInAction, signOutAction } from './form-actions.js';
import { buildProviders } from './providers.js';
import { localRedirect } from './redirect.js';
import { requireAuthSettings } from './settings.js';

export { localRedirect } from './redirect.js';

export interface Authentication {
	readonly strategy: 'credentials' | 'oidc';
	readonly handle: Handle;
	signIn(event: RequestEvent): Promise<void>;
	signOut(event: RequestEvent): Promise<void>;
}

const WEEK_SECONDS = 7 * 24 * 60 * 60;

const authJsLogger: NonNullable<SvelteKitAuthConfig['logger']> = {
	error() {
		logger.error('Auth.js failed (authjs_error).');
	},
	warn(code) {
		// SvelteKit always sets /auth; core warns on every call when AUTH_URL is also set.
		if (code === 'env-url-basepath-redundant') return;
		logger.warn('Auth.js warning (authjs_warning).');
	},
	debug() {}
};

export function createAuthentication(
	config: DirectoryAuth,
	env: ConfigEnvironment = process.env
): Authentication {
	const { secret, origin } = requireAuthSettings(env);
	const strategy = config.credentials ? 'credentials' : 'oidc';
	const policy = { origin, strategy } as const;
	const authJs = SvelteKitAuth({
		secret,
		trustHost: true,
		basePath: '/auth',
		// An empty value prevents Auth.js from enabling an environment-inferred redirect proxy.
		redirectProxyUrl: '',
		session: { strategy: 'jwt', maxAge: WEEK_SECONDS },
		providers: buildProviders(config),
		pages: { signIn: '/signin', error: '/signin' },
		callbacks: {
			redirect: ({ url }) => origin + localRedirect(url, origin)
		},
		logger: authJsLogger
	});
	const handle = sequence(
		(input) => protectAuthRequest(input, policy),
		authJs.handle,
		(input) => requireSignIn(input, policy)
	);
	return {
		strategy,
		handle,
		signIn: (event) => signInAction(event, origin, strategy, authJs),
		signOut: (event) => signOutAction(event, origin, authJs)
	};
}
