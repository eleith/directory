import { describe, expect, it } from 'vitest';
import { GET, HEAD } from './+server.js';

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>照片</text></svg>';

function eventFor(id = 'photos', method = 'GET') {
	return {
		locals: { snapshot: { assets: { bookmarkLogos: Object.freeze({ photos: svg }) } } },
		params: { id },
		request: new Request(`http://localhost/bookmarks/${id}/logo`, { method })
	} as unknown as Parameters<typeof GET>[0];
}

describe('bookmark logo API', () => {
	it('returns only the captured SVG with private image headers', async () => {
		const response = await GET(eventFor());
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(svg);
		expect(response.headers.get('content-type')).toBe('image/svg+xml');
		expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(svg)));
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it.each(['photos', 'missing'])('HEAD matches GET headers without a body for %s', async (id) => {
		const get = await GET(eventFor(id));
		const head = await HEAD(eventFor(id, 'HEAD'));
		expect(head.status).toBe(get.status);
		expect([...head.headers]).toEqual([...get.headers]);
		expect(await head.text()).toBe('');
	});

	it.each(['missing', '__proto__', 'constructor', 'toString'])(
		'rejects unknown or inherited key %s',
		async (id) => {
			const response = await GET(eventFor(id));
			expect(response.status).toBe(404);
			expect(await response.text()).toBe('Not found');
			expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
			expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength('Not found')));
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		}
	);
});
