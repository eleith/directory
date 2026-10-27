import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { navigateQuery } from './support/navigation.js';
import { startServer, type TestServer } from './support/server.js';

const title = 'A household directory with a very long unbroken title HouseholdDirectoryForEveryone';
const siteDescription = 'Useful services for everyone in the household.';
const username = 'PRIVATE_HEADER_USER';
const password = 'PRIVATE_HEADER_PASSWORD';
const sourceA = '/public/private-brand-a.svg';
const sourceB = '/public/private-brand-b.svg';
const icon =
	'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0f766e"/></svg>';
const tabIcon =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8"/></svg>';

let directory: string;
let publicDir: string;
let server: TestServer | undefined;

function configuration(source?: string, auth = false) {
	const logo = source === undefined ? '' : `  logo_path: ${source}\n`;
	const authentication = auth
		? `auth:
  credentials:
    username: ${username}
    password: ${password}
`
		: '';
	return `site:
  url: '\${TEST_ORIGIN}'
  title: ${title}
  description: ${siteDescription}
  favicon_path: /public/tab.svg
${logo}links:
  book:
    title: A bookmark
    url: https://book.example.test
${authentication}`;
}

async function boot(source?: string, auth = false) {
	server = await startServer({
		configuration: configuration(source, auth),
		publicDir
	});
	await server.ready();
	return server;
}

async function expectDecoded(image: Locator, source: string) {
	await expect(image).toHaveAttribute('src', source);
	await expect
		.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0);
	await image.evaluate((node) => (node as HTMLImageElement).decode());
	await expect(image).toHaveAttribute('alt', '');
	await expect(image).toHaveAttribute('width', '48');
	await expect(image).toHaveAttribute('height', '48');
	await expect(image).toHaveAttribute('loading', 'eager');
	expect(
		await image.evaluate((node) => [
			node.getBoundingClientRect().width,
			node.getBoundingClientRect().height
		])
	).toEqual([48, 48]);
}

async function expectBroken(image: Locator) {
	await expect(image).toHaveJSProperty('complete', true);
	await expect(image).toHaveJSProperty('naturalWidth', 0);
}

function expectNoPrivateData(text: string) {
	for (const value of [sourceA, sourceB, username, password, icon]) {
		expect(text).not.toContain(value);
	}
}

test.setTimeout(60_000);

test.beforeEach(async () => {
	server = undefined;
	directory = await mkdtemp(join(tmpdir(), 'directory-header-logo-'));
	publicDir = join(directory, 'public');
	await mkdir(publicDir);
	await writeFile(join(publicDir, 'private-brand-a.svg'), icon);
	await writeFile(join(publicDir, 'private-brand-b.svg'), icon);
	await writeFile(join(publicDir, 'tab.svg'), tabIcon);
});

test.afterEach(async () => {
	try {
		if (server) {
			expect(await server.stop()).toEqual({ code: 0, signal: null });
			expect(server.outputTruncated()).toBe(false);
			expectNoPrivateData(server.output());
			for (const value of [directory, server.path]) {
				expect(server.output()).not.toContain(value);
			}
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

for (const javaScriptEnabled of [true, false]) {
	for (const source of [sourceA, undefined]) {
		test(`${source ? 'configured' : 'omitted'} header logo renders at 48px with JavaScript ${javaScriptEnabled ? 'on' : 'off'}`, async ({
			browser
		}) => {
			const app = await boot(source);
			const html = await (await app.fetch('/')).text();
			expect(html).toMatch(
				new RegExp(
					`<img[^>]*src="${source ?? '/favicon.png'}"[^>]*alt=""[^>]*width="48"[^>]*height="48"[^>]*loading="eager"`
				)
			);
			const context = await browser.newContext({ javaScriptEnabled });
			try {
				const page = await context.newPage();
				await page.goto(app.url);
				await expectDecoded(page.locator('header img'), source ?? '/favicon.png');
				await expect(page.locator('header h1')).toHaveText(title);
				await expect(page.locator('header .description')).toHaveText(siteDescription);
				await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
				await expect(page.locator('head link[rel="icon"]')).toHaveJSProperty(
					'href',
					`${app.url}/favicon`
				);
				expect((await app.fetch('/__data.json')).status).toBe(200);
			} finally {
				await context.close();
			}
		});
	}
}

test('without JavaScript a broken configured header leaves title and native navigation usable', async ({
	browser
}) => {
	await writeFile(join(publicDir, 'private-brand-a.svg'), 'not an image');
	const app = await boot(sourceA);
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(app.url);
		await expect(page.locator('header img')).toHaveAttribute('src', sourceA);
		await expectBroken(page.locator('header img'));
		await expect(page.locator('header h1')).toHaveText(title);
		await page.locator('a[href="/?link=book"]').click();
		await expect(page).toHaveURL(`${app.url}/?link=book`);
		await expect(page.locator('header .description')).toHaveText(siteDescription);
	} finally {
		await context.close();
	}
});

test('source changes retry A to B to repaired A in place, and hydrated errors use the bundle', async ({
	page
}) => {
	await writeFile(join(publicDir, 'private-brand-a.svg'), 'not an image');
	const app = await boot(sourceA);
	let primaryARequests = 0;
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === sourceA) primaryARequests++;
	});
	await page.goto(app.url);
	const image = page.locator('header img');
	await expectDecoded(image, '/favicon.png');
	expect(primaryARequests).toBe(1);
	await page.evaluate(() => Reflect.set(window, 'headerNavigationMarker', true));
	const originalImage = await image.elementHandle();
	try {
		await app.replace(configuration(sourceB));
		await expect.poll(async () => (await app.fetch('/__data.json')).text()).toContain(sourceB);
		await navigateQuery(page, '/?link=book');
		await expect(page).toHaveURL(`${app.url}/?link=book`);
		await expectDecoded(image, sourceB);

		await writeFile(join(publicDir, 'private-brand-a.svg'), icon);
		await app.replace(configuration(sourceA));
		await expect.poll(async () => (await app.fetch('/__data.json')).text()).toContain(sourceA);
		await navigateQuery(page, '/');
		await expect(page).toHaveURL(`${app.url}/`);
		await expectDecoded(image, sourceA);
		expect(primaryARequests).toBe(2);

		await app.replace(configuration('/public/missing-brand.svg'));
		await expect
			.poll(async () => (await app.fetch('/__data.json')).text())
			.toContain('/public/missing-brand.svg');
		const failedPrimary = page.waitForResponse(
			(response) => new URL(response.url()).pathname === '/public/missing-brand.svg'
		);
		await navigateQuery(page, '/?link=book');
		expect((await failedPrimary).status()).toBe(404);
		await expectDecoded(image, '/favicon.png');
		expect(await page.evaluate(() => Reflect.get(window, 'headerNavigationMarker'))).toBe(true);
		expect(
			await image.evaluate((node, previous) => node === previous && node.isConnected, originalImage)
		).toBe(true);
	} finally {
		await originalImage?.dispose();
	}
});

test('logo source and credentials stay private while selected bytes brand sign-in and the narrow header', async ({
	browser
}) => {
	const app = await boot(sourceA, true);
	for (const method of ['GET', 'HEAD']) {
		for (const cookie of ['', 'authjs.session-token=invalid-header-cookie']) {
			const response = await app.fetch(sourceA, {
				method,
				headers: { accept: 'text/html', cookie }
			});
			expect(response.status).toBe(401);
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			expect(response.headers.has('location')).toBe(false);
			const text = await response.text();
			if (method === 'HEAD') expect(text).toBe('');
			expectNoPrivateData(text);
		}
	}
	for (const path of ['/signin', '/signin/__data.json?x-sveltekit-invalidated=11']) {
		const response = await app.fetch(path);
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).toContain(title);
		expect(text).toContain('/favicon');
		expectNoPrivateData(text);
	}
	expect(await (await app.fetch('/favicon')).text()).toBe(tabIcon);
	const context = await browser.newContext({
		javaScriptEnabled: false,
		viewport: { width: 360, height: 800 }
	});
	try {
		const page = await context.newPage();
		await page.goto(app.url);
		await expect(page.locator('header img')).toHaveAttribute('src', '/logo');
		await expect
			.poll(() =>
				page.locator('header img').evaluate((node) => (node as HTMLImageElement).naturalWidth)
			)
			.toBeGreaterThan(0);
		expectNoPrivateData(await page.content());
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expectDecoded(page.locator('header img'), sourceA);
		const signout = page.getByRole('button', { name: 'Sign out' });
		await expect(signout).toBeVisible();
		await expect(signout).toBeInViewport();
		expect(
			await page
				.locator('header h1')
				.evaluate(
					(node) =>
						node.getBoundingClientRect().height > parseFloat(getComputedStyle(node).lineHeight)
				)
		).toBe(true);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			360
		);
		for (const method of ['GET', 'HEAD']) {
			const response = await context.request.fetch(`${app.url}${sourceA}`, { method });
			expect(response.status()).toBe(200);
			expect(await response.text()).toBe(method === 'HEAD' ? '' : icon);
		}
		await signout.click();
		await expect(page.locator('header img')).toHaveAttribute('src', '/logo');
		expectNoPrivateData(await page.content());
	} finally {
		await context.close();
	}
});
