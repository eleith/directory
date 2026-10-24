import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { credentialsAuth, password, username } from './support/configuration.js';
import { startServer, type TestServer } from './support/server.js';

const privateDescription = 'PRIVATE_IMAGE_DESCRIPTION';
const privateLogo =
	'<svg xmlns="http://www.w3.org/2000/svg"><text>PRIVATE_IMAGE_BYTES</text></svg>';
const privateBrand =
	'<svg xmlns="http://www.w3.org/2000/svg"><text>PRIVATE_BRAND_BYTES</text></svg>';
const replacementImage =
	'<svg xmlns="http://www.w3.org/2000/svg"><text>Replacement image</text></svg>';
const privateValues = [
	privateDescription,
	'PRIVATE_BOOKMARK_DESCRIPTION',
	'PRIVATE_IMAGE_BYTES',
	'PRIVATE_BRAND_BYTES',
	username,
	password
];
const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
	'base64'
);

test.setTimeout(60_000);

function configuration(auth = credentialsAuth) {
	return `site:
  title: Configured images fixture
  description: ${privateDescription}
  logo_path: /public/brand logo.svg
links:
  photos:
    title: Photos
    url: https://photos.example.test
    description: PRIVATE_BOOKMARK_DESCRIPTION
    group: Family
    logo_path: /public/photo.svg
  router:
    title: Router
    url: http://router.example.test
  thumbnail:
    title: Photo thumbnail
    url: https://thumbnail.example.test
    logo_path: /public/photo.png
${auth}`;
}

async function fixtures() {
	const directory = await mkdtemp(join(tmpdir(), 'directory-configured-images-'));
	const publicDir = join(directory, 'public');
	try {
		await mkdir(publicDir);
		await writeFile(join(publicDir, 'brand logo.svg'), privateBrand);
		await writeFile(join(publicDir, 'photo.svg'), privateLogo);
		await writeFile(join(publicDir, 'photo.png'), png);
		return { directory, publicDir };
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
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

function expectPrivateHeaders(response: Response) {
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

async function expectNoPrivateData(response: Response) {
	const text = await response.text();
	for (const value of privateValues) expect(text).not.toContain(value);
}

async function stop(server: TestServer, directory: string) {
	try {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
		const output = server.output();
		expect(server.outputTruncated()).toBe(false);
		for (const value of [...privateValues, directory, server.path, server.secret!]) {
			if (value) expect(output).not.toContain(value);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test('mounted files and generated bookmark logos require a real session, including encoded HTML requests', async () => {
	const fixture = await fixtures();
	const server = await startServer({
		configuration: configuration(),
		publicDir: fixture.publicDir
	});
	try {
		await server.ready();
		for (const method of ['GET', 'HEAD']) {
			for (const cookie of ['', 'authjs.session-token=invalid-session']) {
				for (const path of [
					'/public/photo.svg',
					'/public/photo.png',
					'/public/brand%20logo.svg',
					'/%70ublic/photo.svg',
					'/public/photo%2Esvg',
					'/public/unknown.svg',
					'/public',
					'/bookmarks/photos/logo',
					'/bookmarks/missing/logo',
					'/%62ookmarks/photos/logo',
					'/bookmarks/%70hotos/logo',
					'/bookmarks/photos/%6cogo'
				]) {
					const denied = await server.fetch(path, {
						method,
						headers: { accept: 'text/html', cookie }
					});
					expect(denied.status).toBe(401);
					expect(denied.headers.has('location')).toBe(false);
					expectPrivateHeaders(denied);
					if (method === 'HEAD') expect(await denied.text()).toBe('');
					else await expectNoPrivateData(denied);
				}
			}
		}
		for (const path of ['/healthz', '/favicon.svg', '/signin']) {
			const response = await server.fetch(path);
			expect(response.status).toBe(200);
			await expectNoPrivateData(response);
		}
		for (const path of ['/__data.json', '/public/photo.svg/__data.json']) {
			const denied = await server.fetch(path);
			expect(denied.status).toBe(401);
			await expectNoPrivateData(denied);
		}

		const cookie = await signIn(server);
		for (const path of [
			'/public/photo.svg',
			'/public/photo.png',
			'/public/brand%20logo.svg',
			'/%70ublic/photo.svg',
			'/bookmarks/photos/logo'
		]) {
			const image = await server.fetch(path, { headers: { cookie } });
			expect(image.status).toBe(200);
			expectPrivateHeaders(image);
			const head = await server.fetch(path, { method: 'HEAD', headers: { cookie } });
			expect(head.status).toBe(200);
			expectPrivateHeaders(head);
			for (const header of ['content-length', 'content-type']) {
				expect(head.headers.get(header)).toBe(image.headers.get(header));
			}
			expect(await head.text()).toBe('');
			await image.arrayBuffer();
		}
		expect(await (await server.fetch('/public/photo.svg', { headers: { cookie } })).text()).toBe(
			privateLogo
		);
		const data = await server.fetch('/__data.json', { headers: { cookie } });
		const payload = await data.text();
		expect(payload).toContain('/public/photo.svg');
		for (const value of [
			username,
			password,
			server.path,
			fixture.publicDir,
			server.secret!,
			'<svg'
		]) {
			expect(payload).not.toContain(value);
		}
	} finally {
		await stop(server, fixture.directory);
	}
});

test('open mode serves only exact contained image references, with MIME and bodyless HEAD responses', async () => {
	const fixture = await fixtures();
	await writeFile(join(fixture.directory, 'outside.svg'), privateLogo);
	await symlink(join(fixture.directory, 'outside.svg'), join(fixture.publicDir, 'escape.svg'));
	await symlink(join(fixture.publicDir, 'photo.svg'), join(fixture.publicDir, 'inside.svg'));
	await writeFile(join(fixture.publicDir, 'not-image.png'), '<html>PRIVATE_IMAGE_BYTES</html>');
	await writeFile(join(fixture.publicDir, 'unreferenced.svg'), privateLogo);
	await writeFile(join(fixture.publicDir, '家 icon.svg'), replacementImage);
	const extra = `
  extra:
    title: Extra
    url: https://extra.example.test
    logo_path: /public/escape.svg
  invalid-image:
    title: Invalid image
    url: https://invalid-image.example.test
    logo_path: /public/not-image.png
  inside:
    title: Inside
    url: https://inside.example.test
    logo_path: /public/inside.svg
  unicode:
    title: Unicode image
    url: https://unicode.example.test
    logo_path: /public/家 icon.svg
`;
	const server = await startServer({
		configuration: configuration('') + extra,
		publicDir: fixture.publicDir,
		secret: null,
		origin: null
	});
	try {
		await server.ready();
		for (const [path, bytes, contentType] of [
			['/public/photo.svg', Buffer.from(privateLogo), 'image/svg+xml'],
			['/public/photo.png', png, 'image/png'],
			['/public/inside.svg', Buffer.from(privateLogo), 'image/svg+xml'],
			['/public/%E5%AE%B6%20icon.svg', Buffer.from(replacementImage), 'image/svg+xml']
		] as const) {
			const image = await server.fetch(path, {
				headers: {
					'if-none-match': '*',
					'if-modified-since': new Date().toUTCString(),
					range: 'bytes=0-2'
				}
			});
			expect(image.status).toBe(200);
			expect(image.headers.get('content-type')).toBe(contentType);
			expect(image.headers.get('content-length')).toBe(String(bytes.length));
			expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
			expectPrivateHeaders(image);
			for (const header of ['etag', 'last-modified', 'accept-ranges', 'content-range']) {
				expect(image.headers.has(header)).toBe(false);
			}
			const head = await server.fetch(path, { method: 'HEAD' });
			expect(head.status).toBe(200);
			expectPrivateHeaders(head);
			expect(head.headers.get('content-type')).toBe(contentType);
			expect(head.headers.get('content-length')).toBe(String(bytes.length));
			expect(await head.text()).toBe('');
		}
		for (const path of [
			'/public/escape.svg',
			'/public/not-image.png',
			'/public/unreferenced.svg',
			'/public/missing.svg',
			'/public/PHOTO.svg',
			'/bookmarks/missing/logo',
			'/bookmarks/constructor/logo',
			'/public/%2e%2e%2foutside.svg',
			'/public/%252e%252e%252foutside.svg',
			'/public/%5coutside.svg'
		]) {
			for (const method of ['GET', 'HEAD']) {
				const response = await server.fetch(path, { method });
				expect(response.status).toBe(404);
				expect(await response.text()).toBe(method === 'HEAD' ? '' : 'Not found');
				expect(response.headers.get('content-length')).toBe('9');
				expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
				expectPrivateHeaders(response);
			}
		}
		expect((await server.fetch('/public/photo.svg', { method: 'POST' })).status).toBe(405);
		const generated = await server.fetch('/bookmarks/photos/logo');
		expect(generated.status).toBe(200);
		expectPrivateHeaders(generated);
		const svg = await generated.text();
		expect(svg).toContain('width="64"');
		expect(svg).toContain('height="64"');
		expect(svg).toContain('>PH</text>');
	} finally {
		await stop(server, fixture.directory);
	}
});

test('accepted reloads replace exact references; invalid and auth-changing candidates keep last-good images', async () => {
	const fixture = await fixtures();
	await writeFile(join(fixture.publicDir, 'replacement.svg'), replacementImage);
	const server = await startServer({
		configuration: configuration(),
		publicDir: fixture.publicDir
	});
	try {
		await server.ready();
		const cookie = await signIn(server);
		const original = await (
			await server.fetch('/bookmarks/photos/logo', { headers: { cookie } })
		).text();
		const replacement = configuration()
			.replace('/public/photo.svg', '/public/replacement.svg')
			.replace('title: Photos', 'title: Updated Photos');
		await server.replace(replacement);
		await expect
			.poll(
				async () => (await server.fetch('/public/replacement.svg', { headers: { cookie } })).status
			)
			.toBe(200);
		expect((await server.fetch('/public/photo.svg', { headers: { cookie } })).status).toBe(404);
		const changed = await (
			await server.fetch('/bookmarks/photos/logo', { headers: { cookie } })
		).text();
		expect(changed).not.toBe(original);
		expect(changed).toContain('>UP</text>');

		await server.replace('version: [invalid');
		await expect.poll(() => server.output()).toContain('load_failed');
		expect(
			await (await server.fetch('/public/replacement.svg', { headers: { cookie } })).text()
		).toBe(replacementImage);
		expect((await server.fetch('/public/photo.svg', { headers: { cookie } })).status).toBe(404);
		expect(
			await (await server.fetch('/bookmarks/photos/logo', { headers: { cookie } })).text()
		).toBe(changed);

		await server.replace(configuration().replace(password, 'CHANGED_PASSWORD'));
		await expect.poll(() => server.output()).toContain('restart_required');
		expect(
			await (await server.fetch('/public/replacement.svg', { headers: { cookie } })).text()
		).toBe(replacementImage);
		expect((await server.fetch('/public/photo.svg', { headers: { cookie } })).status).toBe(404);
		expect(
			await (await server.fetch('/bookmarks/photos/logo', { headers: { cookie } })).text()
		).toBe(changed);

		await server.replace(configuration());
		await expect
			.poll(async () => (await server.fetch('/public/photo.svg', { headers: { cookie } })).status)
			.toBe(200);
		expect((await server.fetch('/public/replacement.svg', { headers: { cookie } })).status).toBe(
			404
		);
		expect(
			await (await server.fetch('/bookmarks/photos/logo', { headers: { cookie } })).text()
		).toBe(original);
	} finally {
		await stop(server, fixture.directory);
	}
});

test('missing and atomically replaced bytes recover without changing the prepared bookmark API', async () => {
	const fixture = await fixtures();
	await rm(join(fixture.publicDir, 'photo.svg'));
	const server = await startServer({
		configuration: configuration(''),
		publicDir: fixture.publicDir,
		secret: null,
		origin: null
	});
	try {
		await server.ready();
		const before = await (await server.fetch('/bookmarks/photos/logo')).text();
		expect((await server.fetch('/public/photo.svg')).status).toBe(404);
		await writeFile(join(fixture.publicDir, 'new.svg'), privateLogo);
		await rename(join(fixture.publicDir, 'new.svg'), join(fixture.publicDir, 'photo.svg'));
		expect(await (await server.fetch('/public/photo.svg')).text()).toBe(privateLogo);
		await writeFile(join(fixture.publicDir, 'new.svg'), replacementImage);
		await rename(join(fixture.publicDir, 'new.svg'), join(fixture.publicDir, 'photo.svg'));
		expect(await (await server.fetch('/public/photo.svg')).text()).toBe(replacementImage);
		await rm(join(fixture.publicDir, 'photo.svg'));
		expect((await server.fetch('/public/photo.svg')).status).toBe(404);
		expect(await (await server.fetch('/bookmarks/photos/logo')).text()).toBe(before);
	} finally {
		await stop(server, fixture.directory);
	}
});

test('a missing public directory is valid at startup and recovers when its referenced file appears', async () => {
	const fixture = await fixtures();
	await rm(fixture.publicDir, { recursive: true });
	const server = await startServer({
		configuration: configuration(''),
		publicDir: fixture.publicDir,
		secret: null,
		origin: null
	});
	try {
		await server.ready();
		expect((await server.fetch('/healthz')).status).toBe(200);
		expect((await server.fetch('/')).status).toBe(200);
		expect((await server.fetch('/public/photo.svg')).status).toBe(404);
		await mkdir(fixture.publicDir);
		await writeFile(join(fixture.publicDir, 'photo.svg'), privateLogo);
		expect(await (await server.fetch('/public/photo.svg')).text()).toBe(privateLogo);
	} finally {
		await stop(server, fixture.directory);
	}
});

test('existing SSR cards and details render mounted logos and omitted-path bookmark logos without JavaScript', async ({
	browser
}) => {
	const fixture = await fixtures();
	const server = await startServer({
		configuration: configuration(),
		publicDir: fixture.publicDir
	});
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		await server.ready();
		const page = await context.newPage();
		await page.goto(server.url);
		await expect(page).toHaveURL(`${server.url}/signin?callbackUrl=%2F`);
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
		for (const [id, path] of [
			['photos', '/public/photo.svg'],
			['router', '/bookmarks/router/logo'],
			['thumbnail', '/public/photo.png']
		] as const) {
			const image = page.locator(`a[href="/?link=${id}"] img`);
			await expect(image).toHaveAttribute('src', path);
			await expect
				.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
				.toBeGreaterThan(0);
		}
		await page.locator('a[href="/?link=photos"]').click();
		const details = page
			.getByRole('region', { name: 'Photos', exact: true })
			.locator('img[src="/public/photo.svg"]');
		await expect(details).toBeVisible();
		await expect
			.poll(() => details.evaluate((node) => (node as HTMLImageElement).naturalWidth))
			.toBeGreaterThan(0);
		const image = await context.request.get(`${server.url}/public/photo.svg`);
		expect(image.status()).toBe(200);
		expect(await image.text()).toBe(privateLogo);
	} finally {
		await context.close();
		await stop(server, fixture.directory);
	}
});
