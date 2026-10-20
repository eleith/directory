import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types.js';

export const load = (({ locals, url }) => {
	const directory = locals.snapshot.display;
	const requestedLinks = url.searchParams.getAll('link');
	if (requestedLinks.length > 1) error(404, 'Not found');

	const selectedLinkId = requestedLinks[0] ?? null;
	if (
		selectedLinkId !== null &&
		(selectedLinkId === '' ||
			!directory.groups.some((group) => group.links.some((link) => link.id === selectedLinkId)))
	) {
		error(404, 'Not found');
	}

	return { directory, selectedLinkId, signedIn: Boolean(locals.session) };
}) satisfies PageServerLoad;

export const actions = {
	signout: async (event) => {
		if (!event.locals.authentication) redirect(303, '/');
		await event.locals.authentication.signOut(event);
	}
} satisfies Actions;
