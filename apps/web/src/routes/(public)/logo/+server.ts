import { readMountedImage } from '../../../lib/server/images/read-mounted-image.js';
import { imageResponse } from '../../../lib/server/images/image-response.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, request }) => {
	const selectedSource = locals.snapshot.configuration.site.logo_path;
	if (!selectedSource.startsWith('/public/')) return imageResponse(request.method);
	const image = await readMountedImage(locals.publicDir, selectedSource);
	return imageResponse(request.method, image);
};

export const HEAD = GET;
