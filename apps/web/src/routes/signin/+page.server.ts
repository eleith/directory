import { redirect } from '@sveltejs/kit';
import { localRedirect } from '../../lib/server/auth/redirect.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load = (async ({ locals, url }) => {
	const authentication = locals.authentication;
	if (!authentication) redirect(303, '/');

	const callbackUrl = localRedirect(url.searchParams.get('callbackUrl'), url.origin);
	const session = await locals.auth();
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
