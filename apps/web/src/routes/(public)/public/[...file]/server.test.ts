import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readMountedImage } from '../../../../lib/server/images/read-mounted-image.js';
import { GET, HEAD } from './+server.js';

vi.mock('../../../../lib/server/images/read-mounted-image.js', () => ({
	readMountedImage: vi.fn()
}));

const publicDir = '/mounted/public-images';
const image = { bytes: new TextEncoder().encode('<svg/>'), contentType: 'image/svg+xml' };

function event(file: string, method = 'GET') {
	return {
		params: { file },
		// Mounted files are public independently of configuration and sessions.
		locals: { publicDir },
		request: new Request(`http://localhost/public/${encodeURI(file)}`, { method })
	} as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.mocked(readMountedImage).mockReset().mockResolvedValue(image);
});

describe('public mounted image route', () => {
	it.each(['GET', 'HEAD'])(
		'reads unreferenced images for %s without a snapshot',
		async (method) => {
			const response = await (method === 'HEAD' ? HEAD : GET)(event('unlisted.svg', method));
			expect(readMountedImage).toHaveBeenCalledExactlyOnceWith(publicDir, '/public/unlisted.svg');
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe(image.contentType);
			expect(response.headers.get('content-length')).toBe(String(image.bytes.byteLength));
			expect(await response.text()).toBe(method === 'HEAD' ? '' : '<svg/>');
			if (method === 'HEAD') expect(response.body).toBeNull();
		}
	);

	it.each(['café family.svg', 'caf%C3%A9%20family.svg', '../icon.svg', 'icon.svg?x', ''])(
		'passes Kit-decoded paths unchanged to the validating reader, without a second decode: %s',
		async (file) => {
			await GET(event(file));
			expect(readMountedImage).toHaveBeenCalledExactlyOnceWith(publicDir, `/public/${file}`);
		}
	);

	it.each(['GET', 'HEAD'])(
		'maps an unavailable reader result to a generic %s 404',
		async (method) => {
			vi.mocked(readMountedImage).mockResolvedValue(undefined);
			const response = await (method === 'HEAD' ? HEAD : GET)(event('icon.svg', method));
			expect(readMountedImage).toHaveBeenCalledExactlyOnceWith(publicDir, '/public/icon.svg');
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
