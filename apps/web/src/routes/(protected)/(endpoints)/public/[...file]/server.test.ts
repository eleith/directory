import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readImage } from '../../../../../lib/server/assets.js';
import { GET, HEAD } from './+server.js';

vi.mock('../../../../../lib/server/assets.js', () => ({ readImage: vi.fn() }));

const publicDir = '/mounted/private-images';
const image = { bytes: new TextEncoder().encode('<svg/>'), contentType: 'image/svg+xml' };
const snapshot = (path = '/public/icon.svg') =>
	Object.freeze({ assets: Object.freeze({ referencedPaths: Object.freeze([path]) }) });

function event(file: string, method = 'GET', captured = snapshot()) {
	return {
		params: { file },
		locals: { snapshot: captured, publicDir },
		request: new Request(`http://localhost/public/${encodeURI(file)}`, { method })
	} as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.mocked(readImage).mockReset().mockResolvedValue(image);
});

describe('referenced mounted image route', () => {
	it.each(['GET', 'HEAD'])('reads eligible images for %s', async (method) => {
		const response = await (method === 'HEAD' ? HEAD : GET)(event('icon.svg', method));
		expect(readImage).toHaveBeenCalledExactlyOnceWith(publicDir, '/public/icon.svg');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe(image.contentType);
		expect(response.headers.get('content-length')).toBe(String(image.bytes.byteLength));
		expect(await response.text()).toBe(method === 'HEAD' ? '' : '<svg/>');
		if (method === 'HEAD') expect(response.body).toBeNull();
	});

	it.each(['GET', 'HEAD'])(
		'requires exact captured membership before I/O for %s',
		async (method) => {
			for (const file of [
				'unlisted.svg',
				'ICON.svg',
				'icon.svg/extra',
				'../icon.svg',
				'%2e%2e/icon.svg',
				'%252e%252e/icon.svg',
				'icon.svg?x',
				''
			]) {
				const response = await (method === 'HEAD' ? HEAD : GET)(event(file, method));
				expect(response.status).toBe(404);
				expect(await response.text()).toBe(method === 'HEAD' ? '' : 'Not found');
			}
			expect(readImage).not.toHaveBeenCalled();
		}
	);

	it('passes Kit-decoded paths unchanged, without a second decode', async () => {
		const captured = snapshot('/public/café family.svg');
		expect((await GET(event('café family.svg', 'GET', captured))).status).toBe(200);
		expect(readImage).toHaveBeenCalledExactlyOnceWith(publicDir, '/public/café family.svg');
		vi.mocked(readImage).mockClear();
		expect((await GET(event('caf%C3%A9%20family.svg', 'GET', captured))).status).toBe(404);
		expect(readImage).not.toHaveBeenCalled();
	});

	it('keeps old captured eligibility while a replacement removes the reference', async () => {
		const captured = event('icon.svg');
		const replacement = snapshot('/public/replacement.svg');
		expect((await GET(captured)).status).toBe(200);
		expect((await GET(event('icon.svg', 'GET', replacement))).status).toBe(404);
		expect(readImage).toHaveBeenCalledExactlyOnceWith(publicDir, '/public/icon.svg');
	});

	it.each(['GET', 'HEAD'])(
		'maps an unavailable reader result to a generic %s 404',
		async (method) => {
			vi.mocked(readImage).mockResolvedValue(undefined);
			const response = await (method === 'HEAD' ? HEAD : GET)(event('icon.svg', method));
			expect(readImage).toHaveBeenCalledExactlyOnceWith(publicDir, '/public/icon.svg');
			expect(response.status).toBe(404);
			expect(response.headers.get('content-length')).toBe('9');
			expect(await response.text()).toBe(method === 'HEAD' ? '' : 'Not found');
		}
	);

	it('ignores conditional and range headers', async () => {
		const request = event('icon.svg');
		request.request = new Request(request.request, {
			headers: {
				'if-none-match': '*',
				'if-modified-since': new Date().toUTCString(),
				range: 'bytes=0-2'
			}
		});
		const response = await GET(request);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('<svg/>');
	});
});
