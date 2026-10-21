import type { LayoutServerLoad } from './$types';

export const load = (({ locals }) => {
	const { site } = locals.snapshot.configuration;
	let faviconPath = site.favicon_path;
	if (faviconPath.startsWith('/public/')) faviconPath = '/favicon';
	let logoPath = site.logo_path;
	if (logoPath.startsWith('/public/')) logoPath = '/logo';
	return { faviconPath, logoPath };
}) satisfies LayoutServerLoad;
