import { readMountedImage } from '../../../../lib/server/images/read-mounted-image.js';
import { imageResponse } from '../../../../lib/server/images/image-response.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request }) => {
	const publicPath = `/public/${params.file}`;
	const image = await readMountedImage(locals.publicDir, publicPath);
	return imageResponse(request.method, image);
};

export const HEAD = GET;
