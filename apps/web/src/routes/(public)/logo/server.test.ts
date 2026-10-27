import { validateConfig } from '@directory/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readMountedImage } from '../../../lib/server/images/read-mounted-image.js';
import { prepareSnapshot } from '../../../lib/server/directory/snapshot.js';
import { GET, HEAD } from './+server.js';

vi.mock('../../../lib/server/images/read-mounted-image.js', () => ({ readMountedImage: vi.fn() }));

const publicDir = '/PRIVATE_MOUNTED_ROOT';
const image = { bytes: new TextEncoder().encode('<svg/>'), contentType: 'image/svg+xml' };

function snapshot(logo_path?: string) {
	const site: Record<string, string> = {};
	if (logo_path !== undefined) site.logo_path = logo_path;
	return prepareSnapshot(validateConfig({ site, links: {} }, { env: {} }));
}

function event(method: 'GET' | 'HEAD', captured = snapshot('/public/café family.svg')) {
	return {
		params: {},
		locals: { snapshot: captured, publicDir, session: null, authentication: undefined },
		url: new URL('http://localhost/logo'),
		request: new Request('http://localhost/logo', { method })
	} as Parameters<typeof GET>[0];
}

function expectHeaders(response: Response, contentType: string, length: number) {
	expect(response.headers.get('content-type')).toBe(contentType);
	expect(response.headers.get('content-length')).toBe(String(length));
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

beforeEach(() => {
	vi.mocked(readMountedImage).mockReset().mockResolvedValue(image);
});

describe('public selected-logo alias', () => {
	it.each(['GET', 'HEAD'] as const)('reads exactly the selected source for %s', async (method) => {
		const response = await (method === 'HEAD' ? HEAD : GET)(event(method));
		expect(readMountedImage).toHaveBeenCalledExactlyOnceWith(publicDir, '/public/café family.svg');
		expect(response.status).toBe(200);
		expectHeaders(response, image.contentType, image.bytes.byteLength);
		expect(await response.text()).toBe(method === 'HEAD' ? '' : '<svg/>');
		if (method === 'HEAD') expect(response.body).toBeNull();
	});

	it.each([
		['GET', undefined],
		['HEAD', undefined],
		['GET', '/favicon.svg'],
		['HEAD', '/favicon.svg']
	] as const)('returns 404 before I/O for %s with bundled selection %s', async (method, source) => {
		const response = await GET(event(method, snapshot(source)));
		expect(readMountedImage).not.toHaveBeenCalled();
		expect(response.status).toBe(404);
		expectHeaders(response, 'text/plain; charset=utf-8', 9);
		expect(await response.text()).toBe(method === 'HEAD' ? '' : 'Not found');
		if (method === 'HEAD') expect(response.body).toBeNull();
	});

	it.each(['GET', 'HEAD'] as const)(
		'maps unavailable reader results to generic %s 404',
		async (method) => {
			vi.mocked(readMountedImage).mockResolvedValue(undefined);
			const response = await GET(event(method));
			expect(readMountedImage).toHaveBeenCalledExactlyOnceWith(
				publicDir,
				'/public/café family.svg'
			);
			expect(response.status).toBe(404);
			expectHeaders(response, 'text/plain; charset=utf-8', 9);
			expect(await response.text()).toBe(method === 'HEAD' ? '' : 'Not found');
		}
	);

	it('ignores URL, query, headers and arbitrary filesystem selectors', async () => {
		for (const path of [
			'/logo?file=/public/other.svg&publicDir=/outside',
			'/logo?source=%252e%252e%252fsecret.svg',
			'/logo/other.svg?logo_path=/public/other.svg'
		]) {
			const request = event('GET');
			request.url = new URL(path, 'http://localhost');
			request.request = new Request(request.url, {
				headers: { 'x-public-dir': '/outside', range: 'bytes=0-1', 'if-none-match': '*' }
			});
			expect((await GET(request)).status).toBe(200);
		}
		expect(readMountedImage).toHaveBeenCalledTimes(3);
		for (const args of vi.mocked(readMountedImage).mock.calls)
			expect(args).toEqual([publicDir, '/public/café family.svg']);
	});

	it('uses captured configuration, not display metadata or an additional reference registry', async () => {
		const captured = event('GET');
		captured.locals.snapshot = {
			...captured.locals.snapshot,
			display: snapshot('/public/display.svg').display,
			assets: { referencedPaths: [], brandingPaths: [], bookmarkLogos: {} }
		};
		const replacement = event('GET', snapshot('/public/replacement.png'));
		await GET(captured);
		await GET(replacement);
		expect(vi.mocked(readMountedImage).mock.calls).toEqual([
			[publicDir, '/public/café family.svg'],
			[publicDir, '/public/replacement.png']
		]);
	});
});
