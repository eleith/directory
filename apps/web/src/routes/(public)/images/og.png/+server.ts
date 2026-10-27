import { readMountedImage } from '../../../../lib/server/images/read-mounted-image.js';
import { imageResponse } from '../../../../lib/server/images/image-response.js';
import { renderOpenGraph } from '../../../../lib/server/images/render-open-graph.js';
import { logger } from '../../../../lib/server/logger.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, request }) => {
	const { site, appearance } = locals.snapshot.configuration;
	const favicon = site.favicon_path.startsWith('/public/')
		? await readMountedImage(locals.publicDir, site.favicon_path)
		: undefined;
	try {
		const bytes = await renderOpenGraph({
			url: site.url,
			title: site.title,
			description: site.description,
			primaryLightColor: appearance.primary_light_color,
			primaryDarkColor: appearance.primary_dark_color,
			favicon: favicon?.bytes
		});
		return imageResponse(request.method, { bytes, contentType: 'image/png' });
	} catch {
		logger.error('Open Graph image rendering failed (og_render_failed).');
		return new Response(request.method === 'HEAD' ? null : 'Image unavailable', {
			status: 503,
			headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
		});
	}
};

export const HEAD = GET;
