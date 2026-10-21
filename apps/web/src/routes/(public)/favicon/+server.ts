import { readImage } from '../../../lib/server/assets.js';
import { imageResponse } from '../../../lib/server/image-response.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, request }) => {
	const selectedSource = locals.snapshot.configuration.site.favicon_path;
	if (selectedSource === undefined) return imageResponse(request.method);
	const image = await readImage(locals.publicDir, selectedSource);
	return imageResponse(request.method, image);
};

export const HEAD = GET;
