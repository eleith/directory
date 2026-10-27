import { validateConfig } from '@directory/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareSnapshot } from '../../../../lib/server/directory/snapshot.js';
import { readMountedImage } from '../../../../lib/server/images/read-mounted-image.js';
import { renderOpenGraph } from '../../../../lib/server/images/render-open-graph.js';
import { logger } from '../../../../lib/server/logger.js';
import { GET, HEAD } from './+server.js';

vi.mock('../../../../lib/server/images/read-mounted-image.js', () => ({
	readMountedImage: vi.fn()
}));
vi.mock('../../../../lib/server/images/render-open-graph.js', () => ({ renderOpenGraph: vi.fn() }));
vi.mock('../../../../lib/server/logger.js', () => ({ logger: { error: vi.fn() } }));

const publicDir = '/PRIVATE_MOUNTED_ROOT';
const faviconPath = '/public/café family.svg';
const favicon = { bytes: new TextEncoder().encode('<svg/>'), contentType: 'image/svg+xml' };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 255, 0]);
const appearance = { primary_light_color: '#123456', primary_dark_color: '#abc' };
const branding = {
	title: 'Captured home',
	primaryLightColor: '#123456',
	primaryDarkColor: '#abc'
};

function snapshot(site: Record<string, string> = {}, colors = appearance) {
	return prepareSnapshot(
		validateConfig(
			{
				site: {
					title: branding.title,
					description: 'PRIVATE_SITE_DESCRIPTION',
					footer: 'PRIVATE_FOOTER',
					logo_path: '/public/private-logo.png',
					...site
				},
				appearance: colors,
				auth: {
					origin: 'https://private.example',
					secret: 'PRIVATE_SESSION_SECRET_12345678901234567890',
					credentials: { username: 'PRIVATE_USER', password: 'PRIVATE_PASSWORD' }
				},
				links: {
					private: {
						title: 'PRIVATE_LINK',
						url: 'https://private.example/secret',
						description: 'PRIVATE_LINK_DESCRIPTION',
						group: 'PRIVATE_GROUP',
						tags: ['PRIVATE_TAG'],
						logo_path: '/public/private-link.png',
						requires_auth: true,
						internal_only: true,
						admin_only: true
					}
				}
			},
			{ env: {} }
		)
	);
}

function event(method: 'GET' | 'HEAD', captured = snapshot({ favicon_path: faviconPath })) {
	return {
		params: {},
		locals: { snapshot: captured, publicDir, session: null, authentication: undefined },
		url: new URL('http://localhost/images/og.png'),
		request: new Request('http://localhost/images/og.png', { method })
	} as Parameters<typeof GET>[0];
}

async function expectPNG(response: Response, method: 'GET' | 'HEAD') {
	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toBe('image/png');
	expect(response.headers.get('content-length')).toBe(String(png.byteLength));
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	if (method === 'HEAD') expect(response.body).toBeNull();
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(
		method === 'HEAD' ? new Uint8Array() : png
	);
}

beforeEach(() => {
	vi.mocked(readMountedImage).mockReset().mockResolvedValue(favicon);
	vi.mocked(renderOpenGraph).mockReset().mockResolvedValue(png);
	vi.mocked(logger.error).mockReset();
});

describe('public generated Open Graph image', () => {
	it.each(['GET', 'HEAD'] as const)(
		'reads only the configured favicon and generates a PNG for %s',
		async (method) => {
			const response = await (method === 'HEAD' ? HEAD : GET)(event(method));
			expect(readMountedImage).toHaveBeenCalledExactlyOnceWith(publicDir, faviconPath);
			expect(renderOpenGraph).toHaveBeenCalledExactlyOnceWith({
				...branding,
				favicon: favicon.bytes
			});
			expect(vi.mocked(renderOpenGraph).mock.calls[0]?.[0].favicon).toBe(favicon.bytes);
			await expectPNG(response, method);
			expect(logger.error).not.toHaveBeenCalled();
		}
	);

	it.each([
		['GET', undefined],
		['HEAD', undefined],
		['GET', '/favicon.png'],
		['HEAD', '/favicon.png']
	] as const)(
		'generates %s without reading the bundled favicon selection %s',
		async (method, path) => {
			const config =
				path === undefined ? { links: {} } : { site: { favicon_path: path }, links: {} };
			const captured = prepareSnapshot(validateConfig(config, { env: {} }));
			await expectPNG(await (method === 'HEAD' ? HEAD : GET)(event(method, captured)), method);
			expect(readMountedImage).not.toHaveBeenCalled();
			expect(renderOpenGraph).toHaveBeenCalledExactlyOnceWith({
				title: 'Directory',
				primaryLightColor: '#0f766e',
				primaryDarkColor: '#5eead4',
				favicon: undefined
			});
		}
	);

	it.each(['GET', 'HEAD'] as const)(
		'passes an unavailable favicon as undefined for %s',
		async (method) => {
			vi.mocked(readMountedImage).mockResolvedValue(undefined);
			await expectPNG(await (method === 'HEAD' ? HEAD : GET)(event(method)), method);
			expect(readMountedImage).toHaveBeenCalledExactlyOnceWith(publicDir, faviconPath);
			expect(renderOpenGraph).toHaveBeenCalledExactlyOnceWith({ ...branding, favicon: undefined });
		}
	);

	it.each([
		['GET', '/favicon.png'],
		['HEAD', '/favicon.png'],
		['GET', faviconPath],
		['HEAD', faviconPath]
	] as const)(
		'always generates %s, even with a static OG image and favicon %s',
		async (method, path) => {
			const captured = snapshot({ favicon_path: path, og_image_path: '/public/static-share.jpg' });
			await expectPNG(await (method === 'HEAD' ? HEAD : GET)(event(method, captured)), method);
			expect(vi.mocked(readMountedImage).mock.calls).toEqual(
				path === '/favicon.png' ? [] : [[publicDir, faviconPath]]
			);
			expect(renderOpenGraph).toHaveBeenCalledExactlyOnceWith({
				...branding,
				favicon: path === '/favicon.png' ? undefined : favicon.bytes
			});
		}
	);

	it.each(['GET', 'HEAD'] as const)(
		'ignores request path, queries and headers for %s',
		async (method) => {
			for (const path of [
				'/images/og.png?file=/public/other.jpg&publicDir=/outside&title=ATTACKER',
				'/images/og.png?favicon_path=/public/other.svg&og_image_path=/public/other.jpg&primary_light_color=%23fff&primary_dark_color=%23000',
				'/images/other.png?source=%252e%252e%252fsecret.svg&title=OTHER'
			]) {
				const request = event(method);
				request.url = new URL(path, 'http://attacker.example');
				request.request = new Request(request.url, {
					method,
					headers: {
						'x-public-dir': '/outside',
						'x-favicon-path': '/public/other.svg',
						'x-title': 'HEADER_TITLE',
						'x-primary-light-color': '#fff',
						'x-primary-dark-color': '#000',
						accept: 'image/jpeg',
						range: 'bytes=0-1',
						'if-none-match': '*'
					}
				});
				await expectPNG(await (method === 'HEAD' ? HEAD : GET)(request), method);
			}
			expect(vi.mocked(readMountedImage).mock.calls).toEqual(
				Array.from({ length: 3 }, () => [publicDir, faviconPath])
			);
			expect(vi.mocked(renderOpenGraph).mock.calls).toEqual(
				Array.from({ length: 3 }, () => [{ ...branding, favicon: favicon.bytes }])
			);
		}
	);

	it('keeps captured branding coherent across an async read, excluding display, assets and private data', async () => {
		const replacement = event(
			'GET',
			snapshot(
				{ title: 'Replacement', favicon_path: '/public/replacement.png' },
				{ primary_light_color: '#fed', primary_dark_color: '#654321' }
			)
		);
		const captured = event('GET');
		captured.locals.snapshot = {
			...captured.locals.snapshot,
			display: replacement.locals.snapshot.display,
			assets: { referencedPaths: [], brandingPaths: [], bookmarkLogos: {} }
		};
		const replacementFavicon = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' };
		vi.mocked(readMountedImage).mockImplementationOnce(async () => {
			captured.locals.snapshot = replacement.locals.snapshot;
			return favicon;
		});
		await expectPNG(await GET(captured), 'GET');
		vi.mocked(readMountedImage).mockResolvedValue(replacementFavicon);
		await expectPNG(await GET(replacement), 'GET');
		expect(vi.mocked(readMountedImage).mock.calls).toEqual([
			[publicDir, faviconPath],
			[publicDir, '/public/replacement.png']
		]);
		expect(vi.mocked(renderOpenGraph).mock.calls).toEqual([
			[{ ...branding, favicon: favicon.bytes }],
			[
				{
					title: 'Replacement',
					primaryLightColor: '#fed',
					primaryDarkColor: '#654321',
					favicon: replacementFavicon.bytes
				}
			]
		]);
	});

	it.each(['GET', 'HEAD'] as const)(
		'returns a generic 503 and fixed log message on %s rendering failure',
		async (method) => {
			const error = new Error(`PRIVATE_RENDER_SECRET ${publicDir}`);
			error.stack = 'PRIVATE_STACK_TRACE';
			vi.mocked(renderOpenGraph).mockRejectedValue(error);
			const response = await (method === 'HEAD' ? HEAD : GET)(event(method));
			expect(response.status).toBe(503);
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			if (method === 'HEAD') expect(response.body).toBeNull();
			expect(await response.text()).toBe(method === 'HEAD' ? '' : 'Image unavailable');
			expect(logger.error).toHaveBeenCalledExactlyOnceWith(
				'Open Graph image rendering failed (og_render_failed).'
			);
			expect(
				JSON.stringify([...response.headers, ...vi.mocked(logger.error).mock.calls])
			).not.toContain('PRIVATE');
		}
	);
});
