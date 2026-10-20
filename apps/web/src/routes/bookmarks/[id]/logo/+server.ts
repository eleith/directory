import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = ({ locals, params, request }) => {
	const bookmarkLogos = locals.snapshot.assets.bookmarkLogos;
	let body: string | null = 'Not found';
	let status = 404;
	let contentType = 'text/plain; charset=utf-8';
	if (Object.hasOwn(bookmarkLogos, params.id)) {
		body = bookmarkLogos[params.id]!;
		status = 200;
		contentType = 'image/svg+xml';
	}
	const length = Buffer.byteLength(body);
	if (request.method === 'HEAD') body = null;
	return new Response(body, {
		status,
		headers: {
			'content-type': contentType,
			'content-length': String(length),
			'cache-control': 'private, no-store',
			'x-content-type-options': 'nosniff'
		}
	});
};

export const HEAD = GET;
