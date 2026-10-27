import { expect, test } from '@playwright/test';
import { credentialsAuth, password, username } from './support/configuration.js';
import { startServer } from './support/server.js';

function configuration(auth = '') {
	return `site:
  url: '\${TEST_ORIGIN}'
  title: Bookmark logo directory
links:
  photos:
    title: Family Photos
    url: https://photos.example.test
    group: Memories
  router:
    title: Router
    url: http://router.example.test
${auth}`;
}

test('bookmark logos render on cards and details without JavaScript and follow accepted snapshots', async ({
	browser
}) => {
	const server = await startServer({ configuration: configuration() });
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		await server.ready();
		const page = await context.newPage();
		await page.goto(server.url);
		const card = page.locator('a[href="/?link=photos"] img');
		await expect(card).toHaveAttribute('src', '/bookmarks/photos/logo');
		await expect(card).toHaveAttribute('width', '64');
		await expect(card).toHaveAttribute('height', '64');
		await expect
			.poll(() => card.evaluate((image) => (image as HTMLImageElement).naturalWidth))
			.toBeGreaterThan(0);
		await page.locator('a[href="/?link=photos"]').click();
		const details = page.getByRole('region', { name: 'Family Photos', exact: true });
		await expect(details.locator('img')).toHaveAttribute('src', '/bookmarks/photos/logo');
		expect(await (await server.fetch('/bookmarks/photos/logo')).text()).toContain('>FP</text>');

		await server.replace(configuration().replace('Family Photos', 'Shared Albums'));
		await expect
			.poll(async () => await (await server.fetch('/bookmarks/photos/logo')).text())
			.toContain('>SA</text>');
		await server.replace('links: [invalid');
		await expect.poll(() => server.output()).toContain('load_failed');
		expect(await (await server.fetch('/bookmarks/photos/logo')).text()).toContain('>SA</text>');
		await server.replace('links: {}');
		await expect.poll(async () => (await server.fetch('/bookmarks/photos/logo')).status).toBe(404);
	} finally {
		await context.close();
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('bookmark logo GET and HEAD require a real session and never become public static files', async ({
	page
}) => {
	const server = await startServer({ configuration: configuration(credentialsAuth) });
	try {
		await server.ready();
		for (const method of ['GET', 'HEAD']) {
			const denied = await server.fetch('/bookmarks/photos/logo', {
				method,
				headers: { accept: 'text/html' }
			});
			expect(denied.status).toBe(401);
			expect(denied.headers.get('cache-control')).toBe('private, no-store');
			expect(await denied.text()).not.toContain('<svg');
		}
		expect((await server.fetch('/__data.json')).status).toBe(401);
		await page.goto(server.url);
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.locator('a[href="/?link=photos"] img')).toBeVisible();
		const image = await page.request.get(`${server.url}/bookmarks/photos/logo`);
		expect(image.status()).toBe(200);
		expect(image.headers()['content-type']).toBe('image/svg+xml');
		expect(image.headers()['cache-control']).toBe('private, no-store');
		expect(image.headers()['x-content-type-options']).toBe('nosniff');
		const svg = await image.text();
		expect(svg).toContain('>FP</text>');
		const head = await page.request.head(`${server.url}/bookmarks/photos/logo`);
		expect(head.status()).toBe(200);
		expect(head.headers()['content-length']).toBe(String(Buffer.byteLength(svg)));
		expect(await head.text()).toBe('');
		const data = await page.request.get(`${server.url}/__data.json`);
		const payload = await data.text();
		expect(payload).toContain('/bookmarks/photos/logo');
		for (const value of [username, password, server.path, '<svg'])
			expect(payload).not.toContain(value);
		await page.getByRole('button', { name: 'Sign out' }).click();
		expect(
			(await page.request.get(`${server.url}/bookmarks/photos/logo`, { maxRedirects: 0 })).status()
		).toBe(401);
		for (const value of [username, password, server.path])
			expect(server.output()).not.toContain(value);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});
