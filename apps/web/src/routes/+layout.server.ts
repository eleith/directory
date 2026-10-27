import { readMountedImage } from '../lib/server/images/read-mounted-image.js';
import { documentMetadata } from '../lib/server/document.js';
import type { LayoutServerLoad } from './$types';

export const load = (async ({ locals }) => {
	const { site } = locals.snapshot.configuration;
	const supplied = site.og_image_path
		? await readMountedImage(locals.publicDir, site.og_image_path)
		: undefined;
	let faviconPath = site.favicon_path;
	if (faviconPath.startsWith('/public/')) faviconPath = '/favicon';
	let logoPath = site.logo_path;
	if (logoPath.startsWith('/public/')) logoPath = '/logo';
	return {
		faviconPath,
		logoPath,
		document: documentMetadata(
			site,
			site.url,
			supplied && { path: site.og_image_path!, contentType: supplied.contentType }
		)
	};
}) satisfies LayoutServerLoad;
