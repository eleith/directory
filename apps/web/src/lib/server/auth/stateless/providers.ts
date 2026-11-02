import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, formCsrfMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import type { DirectoryAuth, DirectoryCredentialsAuth } from '@directory/config/types';
import { verifyCredentials } from '../credentials.js';

export function buildAuthOptions(
	config: DirectoryAuth,
	origin: string
): Pick<BetterAuthOptions, 'plugins' | 'onAPIError'> {
	if (config.credentials) {
		return { plugins: [credentialsProvider({ ...config.credentials })] };
	}
	const oidc = config.oidc;
	return {
		plugins: [
			genericOAuth({
				config: [
					{
						providerId: 'oidc',
						name: 'SSO',
						discoveryUrl: `${oidc.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`,
						clientId: oidc.client_id,
						clientSecret: oidc.client_secret,
						tokenEndpointAuth: { method: 'client_secret_basic' },
						scopes: ['openid', 'profile', 'email'],
						pkce: true,
						requireIdTokenVerification: true,
						disableProviderLogout: true
					}
				]
			})
		],
		onAPIError: { errorURL: new URL('/signin', origin).href }
	};
}

function credentialsProvider(credentials: DirectoryCredentialsAuth): BetterAuthPlugin {
	const email = 'directory@directory.local';
	return {
		id: 'directory-credentials',
		endpoints: {
			signInCredentials: createAuthEndpoint(
				'/sign-in/credentials',
				{ method: 'POST', use: [formCsrfMiddleware] },
				async (ctx) => {
					const identity = verifyCredentials(credentials, ctx.body);
					if (!identity) {
						throw new APIError('UNAUTHORIZED', {
							code: 'CredentialsSignin',
							message: 'Invalid username or password'
						});
					}

					// Only the common identity enters the ephemeral adapter, never the password.
					const adapter = ctx.context.internalAdapter;
					const existing = await adapter.findUserByEmail(email);
					let user = existing?.user;
					if (!user) {
						user = await adapter.createUser(
							{ name: identity.name, email, emailVerified: true },
							{ method: 'directory-credentials' }
						);
					}
					const session = await adapter.createSession(user.id);
					if (!session) throw new APIError('INTERNAL_SERVER_ERROR');
					await setSessionCookie(ctx, { session, user });
					return ctx.json({ success: true });
				}
			)
		}
	};
}
