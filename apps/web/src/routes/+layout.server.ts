import { env } from '$env/dynamic/private';
import { readMountedImage } from '../lib/server/images/read-mounted-image.js';
import { documentMetadata } from '../lib/server/document.js';
import type { LayoutServerLoad } from './$types';

export const load = (async ({ locals, url, platform }) => {
	const { site, auth } = locals.snapshot.configuration;
	let origin = auth?.origin ?? url.origin;
	if (!auth && platform?.req && !env.PROTOCOL_HEADER) {
		// adapter-node defaults to HTTPS even on direct HTTP. Only configured proxies
		// may override the native socket protocol via the reconstructed URL.
		const { socket } = platform.req;
		const protocol = 'encrypted' in socket && socket.encrypted === true ? 'https:' : 'http:';
		origin = `${protocol}//${url.host}`;
	}
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
			site.title,
			origin,
			supplied && { path: site.og_image_path!, contentType: supplied.contentType }
		)
	};
}) satisfies LayoutServerLoad;
