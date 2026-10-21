import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { dialogScript, navigateQuery } from './support/details.js';
import { startServer, type TestServer } from './support/server.js';

const sourceA = '/public/service-a.svg';
const sourceB = '/public/service-b.svg';
const icon =
	'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12"/></svg>';
const otherIcon =
	'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>';
const accessibleName = 'Open service (opens in a new tab)';
let directory: string;
let publicDir: string;
let server: TestServer | undefined;

function configuration(source = sourceA, otherSource = sourceB, auth = false) {
	return `site:
  title: Service icon checks
links:
  provided:
    title: Provided icon
    url: https://provided.example.test
    logo_path: /public/primary.svg
    favicon_path: ${source}
  other:
    title: Another icon
    url: https://other.example.test
    logo_path: /public/primary.svg
    favicon_path: ${otherSource}
  omitted:
    title: No service icon
    url: https://omitted.example.test
    logo_path: /public/primary.svg
${auth ? 'auth:\n  credentials:\n    username: icon-user\n    password: icon-password\n' : ''}`;
}

async function boot(source = sourceA, otherSource = sourceB, auth = false) {
	const app = await startServer({
		configuration: configuration(source, otherSource, auth),
		publicDir,
		...(auth ? {} : { secret: null, origin: null })
	});
	server = app;
	await app.ready();
	return app;
}

function control(page: Page) {
	return page.getByRole('link', { name: accessibleName, exact: true });
}

async function expectDecoded(image: Locator, source: string, naturalSize = 24) {
	await expect(image).toHaveAttribute('src', source);
	await image.evaluate((node) => (node as HTMLImageElement).decode());
	await expect(image).toHaveJSProperty('naturalWidth', naturalSize);
	await expect(image).toHaveJSProperty('naturalHeight', naturalSize);
	await expect(image).toHaveAttribute('width', '24');
	await expect(image).toHaveAttribute('height', '24');
	await expect(image).toHaveAttribute('alt', '');
	expect(
		await image.evaluate((node) => [
			node.getBoundingClientRect().width,
			node.getBoundingClientRect().height
		])
	).toEqual([24, 24]);
}

async function expectBroken(image: Locator) {
	await expect(image).toHaveJSProperty('complete', true);
	await expect(image).toHaveJSProperty('naturalWidth', 0);
}

test.setTimeout(60_000);
test.beforeEach(async () => {
	server = undefined;
	directory = await mkdtemp(join(tmpdir(), 'directory-service-icons-'));
	publicDir = join(directory, 'public');
	await mkdir(publicDir);
	await writeFile(join(publicDir, 'service-a.svg'), icon);
	await writeFile(join(publicDir, 'service-b.svg'), otherIcon);
	await writeFile(join(publicDir, 'primary.svg'), icon.replaceAll('24', '64'));
});

test.afterEach(async () => {
	try {
		if (server) expect(await server.stop()).toEqual({ code: 0, signal: null });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

for (const javaScriptEnabled of [true, false]) {
	test(`optional service icons render in SSR with JavaScript ${javaScriptEnabled ? 'on' : 'off'}`, async ({
		browser
	}) => {
		const app = await boot();
		const html = await (await app.fetch('/?link=provided')).text();
		expect(html).toMatch(
			/<img[^>]*src="\/public\/service-a.svg"[^>]*alt=""[^>]*width="24"[^>]*height="24"/
		);
		const context = await browser.newContext({ javaScriptEnabled });
		try {
			const page = await context.newPage();
			await page.goto(`${app.url}/?link=provided`);
			if (javaScriptEnabled) await expect(page.getByRole('dialog')).toBeVisible();
			for (const [id, source] of [
				['provided', sourceA],
				['other', sourceB],
				['omitted', undefined]
			] as const) {
				if (javaScriptEnabled) await navigateQuery(page, `/?link=${id}`);
				else await page.locator(`a[href="/?link=${id}"]`).click();
				const external = control(page);
				await expect(external).toHaveAccessibleName(accessibleName);
				await expect(external).toHaveAttribute('href', `https://${id}.example.test`);
				await expect(external).toHaveAttribute('target', '_blank');
				await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
				if (source) await expectDecoded(external.locator('img'), source);
				else await expect(external.locator('img')).toHaveCount(0);
				const primary = page.locator('section.details img[width="64"]');
				await expect(primary).toHaveAttribute('src', '/public/primary.svg');
				await expect(primary).toHaveAttribute('height', '64');
				await primary.evaluate((node) => (node as HTMLImageElement).decode());
			}
			await expect(page.locator('head link[rel="icon"]')).toHaveJSProperty(
				'href',
				`${app.url}/favicon.svg`
			);
		} finally {
			await context.close();
		}
	});
}

for (const abortFallback of [false, true]) {
	test(`pre-hydration failure uses the same image and ${abortFallback ? 'stops after a failed fallback' : 'decodes one private fallback'}`, async ({
		page
	}) => {
		await writeFile(join(publicDir, 'service-a.svg'), 'not an image');
		const app = await boot();
		let fallbackRequests = 0;
		page.on('request', (request) => {
			if (new URL(request.url()).pathname === '/bookmarks/provided/logo') fallbackRequests++;
		});
		if (abortFallback) await page.route('**/bookmarks/provided/logo', (route) => route.abort());
		const scripts = Promise.withResolvers<void>();
		const dialog = Promise.withResolvers<void>();
		await page.route(`**${dialogScript}`, async (route) => {
			await dialog.promise;
			await route.continue();
		});
		let heldScripts = 0;
		await page.route('**/_app/immutable/**', async (route) => {
			if (route.request().resourceType() === 'script') {
				heldScripts++;
				await scripts.promise;
			}
			await route.fallback();
		});
		try {
			await page.goto(`${app.url}/?link=provided`, { waitUntil: 'commit' });
			const image = control(page).locator('img');
			await expect(image).toHaveAttribute('src', sourceA);
			await expectBroken(image);
			await expect.poll(() => heldScripts).toBeGreaterThan(0);
			const original = await image.elementHandle();
			scripts.resolve();
			await expect(image).toHaveAttribute('src', '/bookmarks/provided/logo');
			if (abortFallback) await expectBroken(image);
			else await expectDecoded(image, '/bookmarks/provided/logo', 64);
			expect(await image.evaluate((node, previous) => node === previous, original)).toBe(true);
			await original?.dispose();
			dialog.resolve();
			await expect(page.getByRole('dialog')).toBeVisible();
			if (abortFallback) await expectBroken(image);
			else await expectDecoded(image, '/bookmarks/provided/logo', 64);
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
					)
			);
			expect(fallbackRequests).toBe(2);
		} finally {
			scripts.resolve();
			dialog.resolve();
			await page.unrouteAll({ behavior: 'wait' });
		}
	});
}

test('source and selected identity changes recover in place through native Kit query navigation', async ({
	page
}) => {
	await writeFile(join(publicDir, 'service-a.svg'), 'not an image');
	const app = await boot(sourceA, sourceA);
	await page.goto(`${app.url}/?link=provided`);
	await expect(page.getByRole('dialog')).toBeVisible();
	const image = control(page).locator('img');
	await expectDecoded(image, '/bookmarks/provided/logo', 64);
	const original = await image.elementHandle();
	await page.evaluate(() => Reflect.set(window, 'serviceIconNavigationMarker', true));
	try {
		await navigateQuery(page, '/?link=other');
		await expectDecoded(image, '/bookmarks/other/logo', 64);
		await app.replace(configuration(sourceB, sourceA));
		await expect.poll(async () => (await app.fetch('/__data.json')).text()).toContain(sourceB);
		await navigateQuery(page, '/?link=provided');
		await expectDecoded(image, sourceB);
		await writeFile(join(publicDir, 'service-a.svg'), icon);
		const previousData = await (await app.fetch('/__data.json')).text();
		await app.replace(configuration());
		await expect.poll(async () => (await app.fetch('/__data.json')).text()).not.toBe(previousData);
		await navigateQuery(page, '/?link=other');
		await expectDecoded(image, sourceB);
		await navigateQuery(page, '/?link=provided');
		await expectDecoded(image, sourceA);
		expect(await page.evaluate(() => Reflect.get(window, 'serviceIconNavigationMarker'))).toBe(
			true
		);
		expect(
			await image.evaluate((node, previous) => node === previous && node.isConnected, original)
		).toBe(true);
	} finally {
		await original?.dispose();
	}
});

test('without JavaScript a broken service icon leaves the external control and native links usable', async ({
	browser
}) => {
	await writeFile(join(publicDir, 'service-a.svg'), 'not an image');
	const app = await boot();
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(`${app.url}/?link=provided`);
		await expect(control(page).locator('img')).toHaveAttribute('src', sourceA);
		await expectBroken(control(page).locator('img'));
		await expect(control(page)).toHaveAttribute('href', 'https://provided.example.test');
		await expect(control(page)).toBeVisible();
		await page.locator('a[href="/?link=other"]').click();
		await expectDecoded(control(page).locator('img'), sourceB);
		await page.getByRole('link', { name: 'Back to directory' }).click();
		await expect(page).toHaveURL(`${app.url}/`);
	} finally {
		await context.close();
	}
});

test('service source and default API remain private across real credentials sign-in and sign-out', async ({
	page
}) => {
	const app = await boot(sourceA, sourceB, true);
	for (const path of [sourceA, '/bookmarks/provided/logo']) {
		for (const method of ['GET', 'HEAD']) {
			for (const cookie of ['', 'authjs.session-token=invalid-icon-cookie']) {
				const response = await app.fetch(path, {
					method,
					headers: { accept: 'text/html', cookie }
				});
				expect(response.status).toBe(401);
				expect(response.headers.has('location')).toBe(false);
			}
		}
	}
	await page.goto(`${app.url}/?link=provided`);
	await page.getByLabel('Username').fill('icon-user');
	await page.getByLabel('Password').fill('icon-password');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await expectDecoded(control(page).locator('img'), sourceA);
	for (const path of [sourceA, '/bookmarks/provided/logo']) {
		expect((await page.request.get(`${app.url}${path}`)).status()).toBe(200);
	}
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await page.getByRole('button', { name: 'Sign out' }).click();
	for (const path of [sourceA, '/bookmarks/provided/logo']) {
		expect((await page.request.get(`${app.url}${path}`)).status()).toBe(401);
	}
});
