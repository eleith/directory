import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startServer, type TestServer } from './support/server.js';

const title = 'Favicon fixture';
const username = 'PRIVATE_FAVICON_USER';
const password = 'PRIVATE_FAVICON_PASSWORD';
const sourceA = '/public/café family.svg';
const sourceB = '/public/book.png';
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h16v16H0z"/></svg>';
const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
	'base64'
);
const privateValues = [
	username,
	password,
	'PRIVATE_DESCRIPTION',
	'PRIVATE_FOOTER',
	'PRIVATE_BOOKMARK',
	'https://private.example.test',
	'/public/private-brand.svg',
	sourceA,
	sourceB
];

test.setTimeout(60_000);

function configuration(source?: string, auth = true, selectedPassword = password) {
	let favicon = '';
	if (source !== undefined) favicon = `  favicon_path: ${JSON.stringify(source)}\n`;
	let authentication = '';
	if (auth) {
		authentication = `auth:
  origin: '\${TEST_ORIGIN}'
  credentials:
    username: ${username}
    password: ${selectedPassword}
`;
	}
	return `site:
  title: ${title}
  description: PRIVATE_DESCRIPTION
  footer: PRIVATE_FOOTER
  logo_path: /public/private-brand.svg
${favicon}links:
  book:
    title: PRIVATE_BOOKMARK
    url: https://private.example.test
    logo_path: ${sourceB}
${authentication}`;
}

async function fixtures() {
	const directory = await mkdtemp(join(tmpdir(), 'directory-favicon-'));
	const publicDir = join(directory, 'public');
	try {
		await mkdir(publicDir);
		await writeFile(join(publicDir, 'café family.svg'), svg);
		await writeFile(join(publicDir, 'book.png'), png);
		await writeFile(join(publicDir, 'private-brand.svg'), svg);
		await writeFile(join(publicDir, 'invalid.png'), '<html>not an image</html>');
		return { directory, publicDir };
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

function expectPrivateHeaders(response: Response) {
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

function expectNoPrivateData(text: string, extra: string[] = []) {
	for (const value of [...privateValues, ...extra]) expect(text).not.toContain(value);
}

async function expectImage(
	server: TestServer,
	bytes: Buffer,
	contentType: string,
	cookie = '',
	path = '/favicon'
) {
	for (const method of ['GET', 'HEAD']) {
		const response = await server.fetch(path, {
			method,
			headers: {
				cookie,
				accept: 'text/html',
				range: 'bytes=0-1',
				'if-none-match': '*',
				'if-modified-since': new Date().toUTCString()
			}
		});
		expect(response.status).toBe(200);
		expectPrivateHeaders(response);
		expect(response.headers.get('content-type')).toBe(contentType);
		expect(response.headers.get('content-length')).toBe(String(bytes.length));
		for (const header of ['location', 'etag', 'last-modified', 'accept-ranges', 'content-range']) {
			expect(response.headers.has(header)).toBe(false);
		}
		expect(Buffer.from(await response.arrayBuffer())).toEqual(
			method === 'HEAD' ? Buffer.alloc(0) : bytes
		);
	}
}

async function expectNotFound(server: TestServer) {
	for (const method of ['GET', 'HEAD']) {
		const response = await server.fetch('/favicon', { method });
		expect(response.status).toBe(404);
		expectPrivateHeaders(response);
		expect(response.headers.has('location')).toBe(false);
		expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(response.headers.get('content-length')).toBe('9');
		expect(await response.text()).toBe(method === 'HEAD' ? '' : 'Not found');
	}
}

async function expectRawPrivate(server: TestServer) {
	for (const method of ['GET', 'HEAD']) {
		for (const cookie of ['', 'authjs.session-token=invalid-favicon-cookie']) {
			for (const path of [
				encodeURI(sourceA),
				sourceB,
				'/public/private-brand.svg',
				'/%70ublic/book.png',
				'/public/book%2Epng',
				'/public/unlisted.svg',
				'/bookmarks/book/logo',
				'/__data.json'
			]) {
				const response = await server.fetch(path, {
					method,
					headers: { cookie, accept: 'text/html' }
				});
				expect(response.status, path).toBe(401);
				expectPrivateHeaders(response);
				expect(response.headers.has('location')).toBe(false);
				const text = await response.text();
				if (method === 'HEAD') expect(text).toBe('');
				expectNoPrivateData(text);
			}
		}
	}
}

async function signIn(server: TestServer) {
	const response = await server.fetch('/signin', {
		method: 'POST',
		headers: { accept: 'text/html', origin: server.origin },
		body: new URLSearchParams({ username, password, redirectTo: '/' })
	});
	expect([302, 303]).toContain(response.status);
	const cookie = response.headers.getSetCookie().find((value) => /session-token=/.test(value));
	expect(cookie).toBeDefined();
	return cookie!.split(';')[0]!;
}

async function stop(server: TestServer, directory: string) {
	try {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
		expect(server.outputTruncated()).toBe(false);
		expectNoPrivateData(server.output(), [directory, server.path, svg]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

for (const [source, bytes, contentType] of [
	[sourceA, Buffer.from(svg), 'image/svg+xml'],
	[sourceB, png, 'image/png']
] as const) {
	test(`selected ${contentType} is public only through the alias, including before sign-in without JS`, async ({
		browser
	}) => {
		const fixture = await fixtures();
		const server = await startServer({
			configuration: configuration(source),
			publicDir: fixture.publicDir
		});
		const context = await browser.newContext({ javaScriptEnabled: false });
		try {
			await server.ready();
			const page = await context.newPage();
			await page.goto(server.url);
			await expect(page).toHaveURL(`${server.url}/signin?callbackUrl=%2F`);
			const icon = page.locator('head link[rel="icon"]');
			await expect(icon).toHaveCount(1);
			await expect(icon).toHaveAttribute('href', '/favicon');
			expect(await icon.getAttribute('type')).toBeNull();
			expect(await page.title()).toContain(title);
			expectNoPrivateData(await page.content(), [fixture.publicDir, server.path]);
			const data = await server.fetch('/signin/__data.json?x-sveltekit-invalidated=11');
			expect(data.status).toBe(200);
			const payload = await data.text();
			expect(payload).toContain('/favicon');
			expect(payload).toContain(title);
			expectNoPrivateData(payload, [fixture.publicDir, server.path]);

			const cookie = await signIn(server);
			for (const session of ['', 'authjs.session-token=invalid-favicon-cookie', cookie]) {
				await expectImage(server, bytes, contentType, session);
			}
			await expectRawPrivate(server);
			for (const query of [
				'?file=/public/private-brand.svg&source=/public/book.png',
				'?path=%2Fpublic%2Finvalid.png&publicDir=%2Foutside',
				'?file=%252e%252e%252fsecret.svg'
			]) {
				await expectImage(server, bytes, contentType, '', `/favicon${query}`);
			}
			const extraPath = await server.fetch('/favicon/public/book.png', {
				headers: { accept: 'application/json' }
			});
			expect(extraPath.status).toBe(401);
			expectNoPrivateData(await extraPath.text());
			for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
				const response = await server.fetch('/favicon', {
					method,
					headers: { origin: server.origin }
				});
				expect(response.status).toBe(405);
				expectNoPrivateData(await response.text());
				const crossOrigin = await server.fetch('/favicon', {
					method,
					headers: { origin: 'https://foreign.example.test', 'content-type': 'application/json' },
					body: '{}'
				});
				expect(crossOrigin.status).toBe(403);
				expectNoPrivateData(await crossOrigin.text());
			}
		} finally {
			await context.close();
			await stop(server, fixture.directory);
		}
	});
}

test('valid reloads keep the alias but change bytes; invalid and auth-changing candidates keep last good', async ({
	browser
}) => {
	const fixture = await fixtures();
	const server = await startServer({
		configuration: configuration(sourceA),
		publicDir: fixture.publicDir
	});
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		await server.ready();
		await expectImage(server, Buffer.from(svg), 'image/svg+xml');
		await server.replace(configuration(sourceB));
		await expect
			.poll(async () => (await server.fetch('/favicon')).headers.get('content-type'))
			.toBe('image/png');
		await expectImage(server, png, 'image/png');
		await expectRawPrivate(server);
		const page = await context.newPage();
		await page.goto(`${server.url}/signin`);
		await expect(page.locator('head link[rel="icon"]')).toHaveAttribute('href', '/favicon');

		await server.replace('site: [invalid');
		await expect.poll(() => server.output()).toContain('load_failed');
		await expectImage(server, png, 'image/png');
		await server.replace(configuration(sourceA, true, 'REJECTED_FAVICON_PASSWORD'));
		await expect.poll(() => server.output()).toContain('restart_required');
		await expectImage(server, png, 'image/png');
		await expectRawPrivate(server);
		expectNoPrivateData(server.output(), ['REJECTED_FAVICON_PASSWORD']);

		await server.replace(configuration());
		await expect.poll(async () => (await server.fetch('/favicon')).status).toBe(404);
		await expectNotFound(server);
		await page.reload();
		await expect(page.locator('head link[rel="icon"]')).toHaveAttribute('href', '/favicon.png');
		const bundled = await server.fetch('/favicon.png');
		expect(bundled.status).toBe(200);
		expect(bundled.headers.get('content-type')).toContain('image/png');
		await expectRawPrivate(server);
	} finally {
		await context.close();
		await stop(server, fixture.directory);
	}
});

for (const source of ['/public/missing.svg', '/public/invalid.png']) {
	test(`configured unavailable source ${source} returns 404 without bundled fallback`, async ({
		browser
	}) => {
		const fixture = await fixtures();
		const server = await startServer({
			configuration: configuration(source),
			publicDir: fixture.publicDir
		});
		const context = await browser.newContext({ javaScriptEnabled: false });
		try {
			await server.ready();
			await expectNotFound(server);
			const page = await context.newPage();
			await page.goto(`${server.url}/signin`);
			await expect(page.locator('head link[rel="icon"]')).toHaveCount(1);
			await expect(page.locator('head link[rel="icon"]')).toHaveAttribute('href', '/favicon');
			expectNoPrivateData(await page.content(), [source]);
		} finally {
			await context.close();
			await stop(server, fixture.directory);
		}
	});
}

test('no-auth mode remains open without changing alias selection', async () => {
	const fixture = await fixtures();
	const server = await startServer({
		configuration: configuration(sourceA, false),
		publicDir: fixture.publicDir
	});
	try {
		await server.ready();
		await expectImage(server, Buffer.from(svg), 'image/svg+xml');
		const raw = await server.fetch(encodeURI(sourceA));
		expect(raw.status).toBe(200);
		expect(await raw.text()).toBe(svg);
		expect((await server.fetch('/__data.json')).status).toBe(200);
	} finally {
		await stop(server, fixture.directory);
	}
});
