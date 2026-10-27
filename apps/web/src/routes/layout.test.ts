import { validateConfig } from '@directory/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareSnapshot } from '../lib/server/directory/snapshot.js';
import { readMountedImage } from '../lib/server/images/read-mounted-image.js';
import { load } from './+layout.server.js';

vi.mock('../lib/server/images/read-mounted-image.js', () => ({ readMountedImage: vi.fn() }));

function event(
	site: Record<string, string> = {},
	{
		siteUrl = 'https://directory.example.test',
		url = 'https://internal.example.test/signin?callbackUrl=%2Fprivate&link=PRIVATE_QUERY#PRIVATE_FRAGMENT',
		withAuth = true,
		env = {}
	}: {
		siteUrl?: string | null;
		url?: string;
		withAuth?: boolean;
		env?: Record<string, string | undefined>;
	} = {}
) {
	const snapshot = prepareSnapshot(
		validateConfig(
			{
				site: {
					...(siteUrl === null ? {} : { url: siteUrl }),
					title: 'Home Server',
					description: 'Public site description',
					footer: 'PRIVATE_FOOTER',
					...site
				},
				appearance: { primary_light_color: '#13579b', primary_dark_color: '#c4d6e8' },
				...(!withAuth
					? {}
					: {
							auth: {
								secret: 'PRIVATE_SESSION_SECRET_AT_LEAST_32_CHARACTERS',
								credentials: { username: 'PRIVATE_USERNAME', password: 'PRIVATE_PASSWORD' }
							}
						}),
				links: {
					private: {
						title: 'PRIVATE_LINK',
						url: 'https://private.example.test',
						description: 'PRIVATE_LINK_DESCRIPTION',
						group: 'PRIVATE_GROUP'
					}
				}
			},
			{ env }
		)
	);
	return {
		url: new URL(url),
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
			description: 'Public site description',
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
});

describe('public branding layout data', () => {
	it('publishes only public branding metadata, never private directory data', async () => {
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

	it.each([
		{ name: 'public text', description: 'Public site description' },
		{ name: 'empty text', description: '' },
		{ name: 'whitespace', description: ' \t\n ' },
		{
			name: 'full, unescaped text',
			description: `  <Home> & "family"\n${'Full text. '.repeat(200)}  `
		}
	])('publishes the public site description with $name', async ({ description }) => {
		const data = await load(event({ description }));
		expect(data).toEqual({
			...expectedData(),
			document: { ...expectedData().document, description }
		});
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
		{
			siteUrl: 'https://directory.example.test',
			url: 'http://internal.test:8080/signin?callbackUrl=%2Fsecret#private',
			withAuth: true
		},
		{
			siteUrl: 'http://localhost:3000',
			url: 'https://internal.test/signin?callbackUrl=%2Fsecret#private',
			withAuth: true
		},
		{
			siteUrl: 'https://public.example.test:8443',
			url: 'http://localhost:5173/private/path?link=secret#private',
			withAuth: false
		},
		{
			siteUrl: 'http://public.test:8080',
			url: 'https://untrusted.test/private?tracking=ignored#fragment',
			withAuth: false
		}
	])(
		'uses configured site URL $siteUrl rather than request $url (auth: $withAuth)',
		async ({ siteUrl, url, withAuth }) => {
			const captured = event({}, { siteUrl, url, withAuth });
			const metadata = (await load(captured)).document;
			expect(metadata.url).toBe(`${siteUrl}/`);
			expect(metadata.image.url).toBe(`${siteUrl}/images/og.png`);
		}
	);

	it.each([
		{ env: {}, expected: 'http://localhost:3000' },
		{ env: { PORT: '5173' }, expected: 'http://localhost:5173' },
		{ env: { PORT: '8080' }, expected: 'http://localhost:8080' }
	])('uses the resolved default site URL $expected', async ({ env, expected }) => {
		const captured = event(
			{},
			{
				siteUrl: null,
				withAuth: false,
				url: 'https://untrusted.test:8443/private?tracking=ignored#fragment',
				env
			}
		);
		expect(captured.locals.snapshot.configuration.site.url).toBe(expected);
		const metadata = (await load(captured)).document;
		expect(metadata.url).toBe(`${expected}/`);
		expect(metadata.image.url).toBe(`${expected}/images/og.png`);
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
