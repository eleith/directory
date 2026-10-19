import { configurationVersion } from '@directory/config';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types.js';

export const load = (({ locals }) => ({
	title: locals.snapshot.display.site.title,
	description: locals.snapshot.display.site.description,
	configurationVersion,
	signedIn: Boolean(locals.session)
})) satisfies PageServerLoad;

export const actions = {
	signout: async (event) => {
		if (!event.locals.authentication) redirect(303, '/');
		await event.locals.authentication.signOut(event);
	}
} satisfies Actions;
