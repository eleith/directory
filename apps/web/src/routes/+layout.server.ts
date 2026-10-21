import type { LayoutServerLoad } from './$types';

export const load = (({ locals }) => {
	let faviconPath = '/favicon.svg';
	if (locals.snapshot.configuration.site.favicon_path !== undefined) faviconPath = '/favicon';
	return { faviconPath };
}) satisfies LayoutServerLoad;
