import { readImage } from '../../../../../lib/server/assets.js';
import { imageResponse } from '../../../../../lib/server/image-response.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request }) => {
	const publicPath = `/public/${params.file}`;
	if (!locals.snapshot.assets.referencedPaths.includes(publicPath)) {
		return imageResponse(request.method);
	}
	const image = await readImage(locals.publicDir, publicPath);
	return imageResponse(request.method, image);
};

export const HEAD = GET;
