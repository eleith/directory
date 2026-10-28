import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	configuration,
	privateSentinels,
	siteDescription,
	siteTitle
} from './support/configuration.js';
import { startServer, type TestServer } from './support/server.js';

const generatedPath = '/images/og.png';
const svgPath = '/public/share.svg';
const nextPath = '/public/next.svg';
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h32v32H0z"/></svg>';
const mountedPaths = [
	'/public/logo.svg',
	'/public/link.svg',
	'/public/tab.svg',
	'/public/other.svg'
];
let directory: string;
let publicDir: string;

function brandedConfiguration(image: string) {
	return configuration()
		.replace(
			'site:\n',
			`site:\n  og_image_path: ${image}\n  logo_path: ${mountedPaths[0]}\n  favicon_path: ${mountedPaths[2]}\n`
		)
		.replace(
			'  household:\n',
			`  household:\n    group: PRIVATE_OG_GROUP\n    logo_path: ${mountedPaths[1]}\n`
		);
}

function expectNoPrivateData(text: string) {
	for (const value of [...privateSentinels, 'PRIVATE_OG_GROUP', ...mountedPaths, publicDir]) {
		expect(text).not.toContain(value);
	}
}

// Read the actual SSR head, not a hydrated DOM.
function metadata(html: string) {
	const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
	expect(head).toBeDefined();
	expect(head).not.toMatch(/<meta\b[^>]*(?:name|property)=["']twitter:/i);
	const entries = [
		...head!.matchAll(/<meta\b[^>]*property="(og:[^"]*)"[^>]*content="([^"]*)"[^>]*>/g)
	].map((match) => [match[1], match[2]]);
	expect(new Set(entries.map(([property]) => property)).size).toBe(entries.length);
	const tags = Object.fromEntries(entries);
	expectNoPrivateData(JSON.stringify(tags));
	return tags;
}

async function ssr(server: TestServer, path = '/signin', headers: Record<string, string> = {}) {
	const response = await server.fetch(path, { headers: { accept: 'text/html', ...headers } });
	expect(response.status).toBe(200);
	return response.text();
}

function expectGeneratedMetadata(html: string, origin: string, description = siteDescription) {
	expect(metadata(html)).toEqual({
		'og:type': 'website',
		'og:title': siteTitle,
		...(description.trim() ? { 'og:description': description } : {}),
		'og:site_name': siteTitle,
		'og:url': `${origin}/`,
		'og:image': `${origin}${generatedPath}`,
		'og:image:type': 'image/png',
		'og:image:alt': `Preview of ${siteTitle}`,
		'og:image:width': '1200',
		'og:image:height': '630',
		...(origin.startsWith('https:') ? { 'og:image:secure_url': `${origin}${generatedPath}` } : {})
	});
}

async function expectStatic(server: TestServer, path: string) {
	const response = await server.fetch(path);
	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toBe('image/svg+xml');
	expect(await response.text()).toBe(svg);
}

async function expectPublicAssets(server: TestServer) {
	for (const path of [...mountedPaths, svgPath, nextPath]) {
		await expectStatic(server, path);
	}
	const generatedLogo = await server.fetch('/bookmarks/household/logo');
	expect(generatedLogo.status).toBe(401);
	expectNoPrivateData(await generatedLogo.text());
}

test.setTimeout(60_000);
test.beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'directory-open-graph-'));
	publicDir = join(directory, 'public');
	await mkdir(publicDir);
	for (const path of [...mountedPaths, nextPath]) {
		await writeFile(join(publicDir, path.slice('/public/'.length)), svg);
	}
});
test.afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

test('auth redirects home while sign-in SSR and generated PNG GET/HEAD remain public', async () => {
	const origin = 'https://directory.example.test';
	const server = await startServer({ configuration: configuration(), publicDir, origin });
	try {
		await server.ready();
		const home = await server.fetch('/', { headers: { accept: 'text/html' } });
		expect(home.status).toBe(303);
		expect(new URL(home.headers.get('location')!, server.url).pathname).toBe('/signin');
		expectNoPrivateData(await home.text());
		const html = await ssr(server);
		expectNoPrivateData(html);
		expect(html).not.toMatch(/<meta\b[^>]*name=["']description/i);
		expect(html).not.toContain(server.path);
		expectGeneratedMetadata(html, origin);

		const response = await server.fetch(generatedPath);
		expect(response.status).toBe(200);
		const bytes = Buffer.from(await response.arrayBuffer());
		expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
		expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
		expect(bytes.readUInt32BE(16)).toBe(1200);
		expect(bytes.readUInt32BE(20)).toBe(630);
		const head = await server.fetch(generatedPath, { method: 'HEAD' });
		expect(head.status).toBe(200);
		for (const result of [response, head]) {
			expect(result.headers.get('content-type')).toBe('image/png');
			expect(result.headers.get('content-length')).toBe(String(bytes.length));
			expect(result.headers.get('x-content-type-options')).toBe('nosniff');
			expect(result.headers.has('location')).toBe(false);
		}
		expect(await head.text()).toBe('');
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('missing static image recovers without reload; selection changes metadata, not public file access', async () => {
	const server = await startServer({ configuration: brandedConfiguration(svgPath), publicDir });
	try {
		await server.ready();
		expectGeneratedMetadata(await ssr(server), server.origin);
		await writeFile(join(publicDir, 'share.svg'), svg);
		const html = await ssr(server);
		expectNoPrivateData(html);
		expect(metadata(html)).toMatchObject({
			'og:image': `${server.origin}${svgPath}`,
			'og:image:type': 'image/svg+xml'
		});
		expect(metadata(html)).not.toHaveProperty('og:image:width');
		expect(metadata(html)).not.toHaveProperty('og:image:height');
		await expectPublicAssets(server);

		await server.replace(brandedConfiguration(nextPath));
		await expect
			.poll(async () => metadata(await ssr(server))['og:image'])
			.toBe(`${server.origin}${nextPath}`);
		// Both selected and unselected mounted files remain public.
		await expectPublicAssets(server);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

for (const configuredUrl of [false, true]) {
	test(`no-auth SSR uses ${configuredUrl ? 'configured site.url despite request host and proxy headers' : 'HTTP localhost PORT by default despite PROTOCOL_HEADER'}`, async () => {
		const description = configuredUrl ? 'Useful links for "family" & friends.' : siteDescription;
		const blankDescription = configuredUrl ? '' : '   ';
		let config = configuration('').replace(
			JSON.stringify(siteDescription),
			JSON.stringify(description)
		);
		// Leave site.url absent to exercise shared config's allocated PORT default.
		if (!configuredUrl) config = config.replace("  url: '${TEST_ORIGIN}'\n", '');
		const canonicalUrl = 'https://directory.example.test';
		const server = await startServer({
			configuration: config,
			publicDir,
			...(configuredUrl ? { origin: canonicalUrl } : {}),
			env: {
				ORIGIN: 'https://legacy-origin.example.test',
				AUTH_URL: 'https://legacy-auth.example.test',
				PROTOCOL_HEADER: 'x-forwarded-proto',
				HOST_HEADER: 'x-forwarded-host',
				PORT_HEADER: 'x-forwarded-port'
			}
		});
		const headers = {
			host: 'foreign.example.test',
			'x-forwarded-host': 'proxy.example.test',
			'x-forwarded-proto': 'https',
			'x-forwarded-port': '443',
			forwarded: 'host=forwarded.example.test;proto=https'
		};
		try {
			await server.ready();
			const html = await ssr(server, '/', headers);
			const origin = configuredUrl ? canonicalUrl : server.url;
			// Check the wire HTML, including attribute escaping, without DOM decoding.
			expectGeneratedMetadata(
				html,
				origin,
				configuredUrl ? 'Useful links for &quot;family&quot; &amp; friends.' : description
			);
			await server.replace(
				config.replace(JSON.stringify(description), JSON.stringify(blankDescription))
			);
			await expect
				.poll(async () => metadata(await ssr(server, '/', headers)))
				.not.toHaveProperty('og:description');
			expectGeneratedMetadata(await ssr(server, '/', headers), origin, blankDescription);
		} finally {
			expect(await server.stop()).toEqual({ code: 0, signal: null });
		}
	});
}
