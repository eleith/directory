export function imageResponse(
	method: string,
	image?: { bytes: string | Uint8Array<ArrayBuffer>; contentType: string }
): Response {
	const bytes = image?.bytes ?? 'Not found';
	const length =
		typeof bytes === 'string' ? new TextEncoder().encode(bytes).byteLength : bytes.byteLength;
	const contentType = image?.contentType ?? 'text/plain; charset=utf-8';
	let status = 404;
	if (image) status = 200;
	let body: string | Uint8Array<ArrayBuffer> | null = bytes;
	if (method === 'HEAD') body = null;
	return new Response(body, {
		status,
		headers: {
			'content-type': contentType,
			'content-length': String(length),
			'cache-control': 'private, no-store',
			'x-content-type-options': 'nosniff'
		}
	});
}
