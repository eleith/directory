import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { TLSSocket } from 'node:tls';
import { validateConfig } from '@directory/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareSnapshot } from '../lib/server/directory/snapshot.js';
import { readMountedImage } from '../lib/server/images/read-mounted-image.js';
import { load } from './+layout.server.js';

const env = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('../lib/server/images/read-mounted-image.js', () => ({ readMountedImage: vi.fn() }));

function event(
	site: Record<string, string> = {},
	{
		origin = 'https://directory.example.test',
		url = 'https://internal.example.test/signin?callbackUrl=%2Fprivate&link=PRIVATE_QUERY#PRIVATE_FRAGMENT',
		platform
	}: { origin?: string | null; url?: string; platform?: App.Platform } = {}
) {
	const snapshot = prepareSnapshot(
		validateConfig(
			{
				site: {
					title: 'Home Server',
					description: 'PRIVATE_DESCRIPTION',
					footer: 'PRIVATE_FOOTER',
					...site
				},
				appearance: { primary_light_color: '#13579b', primary_dark_color: '#c4d6e8' },
				...(origin === null
					? {}
					: {
							auth: {
								origin,
								secret: 'PRIVATE_SESSION_SECRET_AT_LEAST_32_CHARACTERS',
								credentials: { username: 'PRIVATE_USERNAME', password: 'PRIVATE_PASSWORD' }
							}
						}),
				links: { private: { title: 'PRIVATE_LINK', url: 'https://private.example.test' } }
			},
			{ env: {} }
		)
	);
	return {
		url: new URL(url),
		platform,
		locals: {
			snapshot,
			publicDir: '/PRIVATE_PUBLIC_ROOT',
			configPath: '/PRIVATE_CONFIG_ROOT/directory.yaml',
			session: { user: { name: 'PRIVATE_IDENTITY' }, expires: '2099-01-01' },
			authentication: undefined
		}
	} as unknown as Parameters<typeof load>[0];
}

function expectedData(faviconPath = '/favicon.png', logoPath = '/favicon.png') {
	return {
		faviconPath,
		logoPath,
		document: {
			title: 'Home Server',
			url: 'https://directory.example.test/',
			image: {
				url: 'https://directory.example.test/images/og.png',
				type: 'image/png',
				width: 1200,
				height: 630
			}
		}
	};
}

beforeEach(() => {
	vi.mocked(readMountedImage).mockReset();
	delete env.PROTOCOL_HEADER;
});

describe('public branding layout data', () => {
	it('publishes only branding and title metadata, never private directory data', async () => {
		const captured = event();
		const before = JSON.stringify(captured.locals);
		const data = await load(captured);
		expect(data).toEqual(expectedData());
		for (const privateValue of ['PRIVATE_', 'private.example.test', '2099-01-01', '#13579b']) {
			expect(JSON.stringify(data)).not.toContain(privateValue);
		}
		expect(JSON.stringify(captured.locals)).toBe(before);
		expect(readMountedImage).not.toHaveBeenCalled();
	});

	it('preserves explicit bundled favicon and logo selections', async () => {
		expect(await load(event({ logo_path: '/favicon.png', favicon_path: '/favicon.png' }))).toEqual(
			expectedData()
		);
	});

	it.each(['/public/PRIVATE_SOURCE.png', '/public/café family.svg'])(
		'keeps existing favicon/logo aliases for %s unchanged',
		async (source) => {
			const data = await load(event({ logo_path: source, favicon_path: source }));
			expect(data).toEqual(expectedData('/favicon', '/logo'));
			expect(JSON.stringify(data)).not.toContain(source);
			expect(readMountedImage).not.toHaveBeenCalled();
		}
	);

	it('does not read directory display data or prepared asset registries', async () => {
		const captured = event();
		captured.locals.snapshot = {
			...captured.locals.snapshot,
			get display(): never {
				throw new Error('Root layout must not read display data');
			},
			get assets(): never {
				throw new Error('Root layout must not read image assets');
			}
		};
		expect(await load(captured)).toEqual(expectedData());
	});

	it.each([
		[
			'https://directory.example.test',
			'http://internal.test:8080/signin?callbackUrl=%2Fsecret#private'
		],
		['http://localhost:3000', 'https://internal.test/signin?callbackUrl=%2Fsecret#private'],
		[null, 'https://public.example.test:8443/signin?callbackUrl=%2Fsecret#private'],
		[null, 'http://localhost:5173/private/path?link=secret#private']
	] as const)(
		'uses canonical origin %s for request %s, with no query or path',
		async (origin, url) => {
			const captured = event({}, { origin, url });
			const metadata = (await load(captured)).document;
			expect(metadata.url).toBe(`${origin ?? captured.url.origin}/`);
			expect(metadata.image.url).toBe(`${origin ?? captured.url.origin}/images/og.png`);
		}
	);

	it.each([
		{ name: 'native HTTP', tls: false, origin: null, expected: 'http://public.test:8080' },
		{ name: 'native TLS', tls: true, origin: null, expected: 'https://public.test:8080' },
		{
			name: 'auth canonical override',
			tls: false,
			origin: 'https://canonical.test',
			expected: 'https://canonical.test'
		},
		{
			name: 'explicit trusted protocol header',
			tls: false,
			origin: null,
			protocolHeader: 'x-forwarded-proto',
			expected: 'https://public.test:8080'
		}
	])('uses $name for production metadata', async ({ tls, origin, protocolHeader, expected }) => {
		env.PROTOCOL_HEADER = protocolHeader;
		const socket = tls ? new TLSSocket(new Socket()) : new Socket();
		const req = new IncomingMessage(socket);
		// Unconfigured forwarded headers must not override the actual transport.
		req.headers['x-forwarded-proto'] = 'https';
		req.headers.forwarded = 'proto=https;host=untrusted.test';
		try {
			const captured = event(
				{},
				{
					origin,
					url: 'https://public.test:8080/private?tracking=ignored#fragment',
					platform: { req }
				}
			);
			const metadata = (await load(captured)).document;
			expect(metadata.url).toBe(`${expected}/`);
			expect(metadata.image.url).toBe(`${expected}/images/og.png`);
		} finally {
			socket.destroy();
		}
	});

	it('uses the URL origin in dev without a native request', async () => {
		const captured = event(
			{},
			{
				origin: null,
				url: 'http://localhost:5173/private?tracking=ignored',
				platform: {}
			}
		);
		expect((await load(captured)).document.url).toBe('http://localhost:5173/');
	});

	it('uses a readable custom image at its own URL, preserving its actual MIME type', async () => {
		vi.mocked(readMountedImage).mockResolvedValue({
			bytes: new TextEncoder().encode('<svg/>'),
			contentType: 'image/svg+xml'
		});
		const source = '/public/images/café family.svg';
		const data = await load(event({ og_image_path: source }));
		expect(readMountedImage).toHaveBeenCalledExactlyOnceWith('/PRIVATE_PUBLIC_ROOT', source);
		expect(data.document.image.url).toBe(
			'https://directory.example.test/public/images/caf%C3%A9%20family.svg'
		);
		expect(data.document.image.type).toBe('image/svg+xml');
		expect(data.document.image).not.toHaveProperty('width');
		expect(data.document.image).not.toHaveProperty('height');
		expect(JSON.stringify(data)).not.toContain('<svg');
	});

	it('selects the generated PNG when the configured file is unavailable, then recovers', async () => {
		const captured = event({ og_image_path: '/public/share.png' });
		expect(await load(captured)).toEqual(expectedData());
		vi.mocked(readMountedImage).mockResolvedValue({
			bytes: new Uint8Array([1]),
			contentType: 'image/png'
		});
		expect((await load(captured)).document.image.url).toBe(
			'https://directory.example.test/public/share.png'
		);
	});

	it('keeps the captured snapshot immutable across later config publications', async () => {
		const captured = event({ favicon_path: '/public/PRIVATE_ICON.svg' });
		const snapshot = captured.locals.snapshot;
		const before = JSON.stringify(snapshot);
		const data = await load(captured);
		expect((await load(event({ title: 'Updated title' }))).document.title).toBe('Updated title');
		expect(await load(captured)).toEqual(data);
		expect(captured.locals.snapshot).toBe(snapshot);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(JSON.stringify(snapshot)).toBe(before);
	});
});
