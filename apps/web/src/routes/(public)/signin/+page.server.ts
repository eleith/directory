import { error as httpError, redirect } from '@sveltejs/kit';
import { localRedirect } from '../../../lib/server/auth/redirect.js';
import { logger } from '../../../lib/server/logger.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load = (async ({ locals, url }) => {
	const authentication = locals.authentication;
	if (!authentication) redirect(303, '/');

	const callbackUrl = localRedirect(url.searchParams.get('callbackUrl'), url.origin);
	const session = await locals.auth().catch(() => {
		logger.error('Authentication session failed (auth_session_failed).');
		httpError(401, 'Access denied');
	});
	if (session?.user) redirect(303, callbackUrl);

	const rawError = url.searchParams.get('error');
	let error: 'credentials' | 'authentication' | null = null;
	if (rawError === 'CredentialsSignin' || rawError === 'credentials') {
		error = 'credentials';
	} else if (rawError !== null) {
		error = 'authentication';
	}

	return {
		title: locals.snapshot.display.site.title,
		strategy: authentication.strategy,
		callbackUrl,
		error
	};
}) satisfies PageServerLoad;

export const actions = {
	default: async (event) => {
		if (!event.locals.authentication) redirect(303, '/');
		await event.locals.authentication.signIn(event);
	}
} satisfies Actions;
