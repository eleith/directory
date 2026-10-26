import { describe, expect, it } from 'vitest';
import { imageResponse } from './image-response.js';

const svg = '<svg><text>照片 café</text></svg>';
const bytes = new TextEncoder().encode(svg);

describe('image responses', () => {
	it.each([
		{ bytes: svg, contentType: 'image/svg+xml' },
		{ bytes, contentType: 'image/svg+xml' },
		undefined
	])('shares GET and HEAD status and headers for %j', async (image) => {
		const get = imageResponse('GET', image);
		const head = imageResponse('HEAD', image);
		expect(get.status).toBe(image ? 200 : 404);
		expect(head.status).toBe(get.status);
		expect([...head.headers]).toEqual([...get.headers]);
		expect(get.headers.get('content-type')).toBe(
			image ? 'image/svg+xml' : 'text/plain; charset=utf-8'
		);
		expect(get.headers.get('content-length')).toBe(String(image ? bytes.byteLength : 9));
		expect(get.headers.get('cache-control')).toBe('private, no-store');
		expect(get.headers.get('x-content-type-options')).toBe('nosniff');
		for (const header of ['etag', 'last-modified', 'accept-ranges', 'content-range']) {
			expect(get.headers.has(header)).toBe(false);
		}
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(
			image ? bytes : new TextEncoder().encode('Not found')
		);
		expect(head.body).toBeNull();
		expect(await head.text()).toBe('');
	});
});
