import { imageResponse } from '../../../../../../lib/server/images/image-response.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = ({ locals, params, request }) => {
	const bookmarkLogos = locals.snapshot.assets.bookmarkLogos;
	if (!Object.hasOwn(bookmarkLogos, params.id)) {
		return imageResponse(request.method);
	}
	return imageResponse(request.method, {
		bytes: bookmarkLogos[params.id]!,
		contentType: 'image/svg+xml'
	});
};

export const HEAD = GET;
