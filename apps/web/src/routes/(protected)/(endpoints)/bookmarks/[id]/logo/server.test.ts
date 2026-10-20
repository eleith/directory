import { describe, expect, it } from 'vitest';
import { GET, HEAD } from './+server.js';

const svg = '<svg><text>照片 café</text></svg>';
const snapshot = (prepared = svg) =>
	Object.freeze({ assets: Object.freeze({ bookmarkLogos: Object.freeze({ photos: prepared }) }) });

function event(id: string, method = 'GET', captured = snapshot()) {
	return {
		locals: { snapshot: captured },
		params: { id },
		request: new Request(`http://localhost/bookmarks/${id}/logo`, { method })
	} as unknown as Parameters<typeof GET>[0];
}

describe('bookmark logo API', () => {
	it.each(['GET', 'HEAD'])('serves only prepared SVG with UTF-8 length for %s', async (method) => {
		const response = await (method === 'HEAD' ? HEAD : GET)(event('photos', method));
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/svg+xml');
		expect(response.headers.get('content-length')).toBe(
			String(new TextEncoder().encode(svg).byteLength)
		);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(await response.text()).toBe(method === 'HEAD' ? '' : svg);
		if (method === 'HEAD') expect(response.body).toBeNull();
	});

	it.each(['missing', '__proto__', 'constructor', 'toString', '../photos', 'photos.svg'])(
		'rejects missing or inherited key %s with a generic 404',
		async (id) => {
			const get = await GET(event(id));
			const head = await HEAD(event(id, 'HEAD'));
			expect(get.status).toBe(404);
			expect(head.status).toBe(404);
			expect(get.headers.get('cache-control')).toBe('private, no-store');
			expect(head.headers.get('x-content-type-options')).toBe('nosniff');
			expect(await get.text()).toBe('Not found');
			expect(head.body).toBeNull();
		}
	);

	it('keeps the captured prepared record when a replacement changes its SVG', async () => {
		const captured = event('photos');
		const replacement = snapshot('<svg><text>Replacement</text></svg>');
		expect(await (await GET(captured)).text()).toBe(svg);
		expect(await (await GET(event('photos', 'GET', replacement))).text()).toBe(
			replacement.assets.bookmarkLogos.photos
		);
		expect(await (await GET(captured)).text()).toBe(svg);
	});
});
