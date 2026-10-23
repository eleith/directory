import { expect, test, type Page } from '@playwright/test';
import { credentialsAuth, password, username } from './support/configuration.js';
import { startServer, type TestServer } from './support/server.js';

const title = 'Home Server';
const description = 'Services for our household';
const longTitle = 'HouseholdServicesAndReferenceShelvesWithAnUnbrokenBrandName';
const longDescription =
	'Private household resources with a description that stays visible. UnbrokenDescriptionForAllHouseholdMembersAndTheirDevices';
let protectedServer: TestServer;
let openServer: TestServer;
let longBrandServer: TestServer;

function configuration(siteTitle: string, siteDescription: string, auth = true) {
	let authentication = '';
	if (auth) authentication = credentialsAuth;
	return `site:
  title: ${siteTitle}
  description: ${siteDescription}
links:
  calendar:
    title: Household calendar
    url: https://calendar.example.test/
${authentication}`;
}

test.beforeAll(async () => {
	protectedServer = await startServer({ configuration: configuration(title, description) });
	openServer = await startServer({
		configuration: configuration(title, description, false),
		secret: null,
		origin: null
	});
	longBrandServer = await startServer({
		configuration: configuration(longTitle, longDescription)
	});
	await Promise.all([protectedServer.ready(), openServer.ready(), longBrandServer.ready()]);
});

test.afterAll(async () => {
	for (const server of [protectedServer, openServer, longBrandServer]) {
		if (server) expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search', exact: true });
const searchFrame = (page: Page) => page.locator('.search-controls.ui-input');
const theme = (page: Page) => page.locator('.header-actions > button');
const signout = (page: Page) => page.getByRole('button', { name: 'Sign out', exact: true });

async function signIn(page: Page, server: TestServer) {
	await page.goto(server.url);
	await page.getByLabel('Username', { exact: true }).fill(username);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(signout(page)).toBeVisible();
}

async function expectHeaderLayout(page: Page, signedIn = true) {
	const header = page.locator('main > header');
	const brand = header.locator(':scope > div').first();
	const tools = page.locator('.header-actions');
	const headerBox = (await header.boundingBox())!;
	const brandBox = (await brand.boundingBox())!;
	const logoBox = (await header.locator('img').boundingBox())!;
	const toolsBox = (await tools.boundingBox())!;
	const searchFrameBox = (await searchFrame(page).boundingBox())!;
	const inputBox = (await search(page).boundingBox())!;
	const themeBox = (await theme(page).boundingBox())!;
	const width = await page.evaluate(() => innerWidth);

	expect(searchFrameBox.height).toBeGreaterThanOrEqual(48);
	expect(inputBox.height).toBeGreaterThanOrEqual(44);
	expect(inputBox.width).toBeGreaterThanOrEqual(44);
	expect(inputBox.x).toBeGreaterThanOrEqual(searchFrameBox.x);
	expect(inputBox.y).toBeGreaterThanOrEqual(searchFrameBox.y);
	expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(searchFrameBox.x + searchFrameBox.width);
	expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(
		searchFrameBox.y + searchFrameBox.height
	);

	expect(brandBox.y).toBeCloseTo(headerBox.y, 1);
	expect(logoBox.y).toBeCloseTo(headerBox.y, 1);
	expect(toolsBox.y).toBeCloseTo(logoBox.y, 1);
	expect(toolsBox.x).toBeGreaterThan(brandBox.x + brandBox.width);
	expect(toolsBox.x + toolsBox.width).toBeCloseTo(headerBox.x + headerBox.width, 1);
	expect(themeBox.width).toBeGreaterThanOrEqual(44);
	expect(themeBox.height).toBeGreaterThanOrEqual(44);
	expect(logoBox.width).toBe(48);
	expect(logoBox.height).toBe(48);
	await expect(header.locator('img')).toHaveAttribute('loading', 'eager');

	if (signedIn) {
		const signoutBox = (await signout(page).boundingBox())!;
		expect(signoutBox.width).toBeGreaterThanOrEqual(44);
		expect(signoutBox.height).toBeGreaterThanOrEqual(44);
		expect(signoutBox.x).toBeGreaterThanOrEqual(themeBox.x + themeBox.width);
		expect(signoutBox.y + signoutBox.height / 2).toBeCloseTo(themeBox.y + themeBox.height / 2, 1);
		await expect(signout(page)).toHaveText('');
		await expect(signout(page)).toHaveAccessibleName('Sign out');
		await expect(signout(page).locator('svg')).toHaveCount(1);
		await expect(signout(page).locator('svg')).toHaveAttribute('aria-hidden', 'true');
		await expect(signout(page).locator('svg')).toHaveAttribute('focusable', 'false');
		await expect(tools.locator('form')).toHaveAttribute('method', 'POST');
		await expect(tools.locator('form')).toHaveAttribute('action', '?/signout');
		await expect(signout(page)).toHaveAttribute('type', 'submit');
	} else {
		await expect(signout(page)).toHaveCount(0);
		await expect(tools.locator('form')).toHaveCount(0);
		expect(toolsBox.width).toBeCloseTo(themeBox.width, 1);
	}

	if (width < 768) {
		expect(searchFrameBox.y).toBeGreaterThanOrEqual(brandBox.y + brandBox.height);
		expect(searchFrameBox.y).toBeGreaterThanOrEqual(toolsBox.y + toolsBox.height);
		expect(searchFrameBox.x).toBeCloseTo(headerBox.x, 1);
		expect(searchFrameBox.width).toBeCloseTo(headerBox.width, 1);
	} else {
		expect(searchFrameBox.y).toBeCloseTo(headerBox.y, 1);
		expect(searchFrameBox.x).toBeGreaterThanOrEqual(brandBox.x + brandBox.width);
		expect(searchFrameBox.x + searchFrameBox.width).toBeLessThan(toolsBox.x);
		const rem = await page.evaluate(() =>
			parseFloat(getComputedStyle(document.documentElement).fontSize)
		);
		expect(searchFrameBox.width).toBeLessThanOrEqual(22 * rem);
	}
	if (themeBox.height <= 48) {
		expect(themeBox.y + themeBox.height / 2).toBeCloseTo(logoBox.y + logoBox.height / 2, 1);
	}
	const headingBox = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
	const descriptionBox = (await header.locator('.description').boundingBox())!;
	expect(headingBox.x + headingBox.width).toBeLessThanOrEqual(brandBox.x + brandBox.width + 1);
	expect(descriptionBox.x + descriptionBox.width).toBeLessThanOrEqual(
		brandBox.x + brandBox.width + 1
	);
	expect(descriptionBox.y).toBeGreaterThanOrEqual(headingBox.y + headingBox.height);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const colorScheme of ['light', 'dark'] as const) {
	for (const width of [360, 390, 414, 768, 1280]) {
		test(`brand and utilities share the top line at ${width}px in ${colorScheme}`, async ({
			page
		}) => {
			await page.emulateMedia({ colorScheme });
			await page.setViewportSize({ width, height: 900 });
			await signIn(page, protectedServer);
			await expect(search(page)).toBeEnabled();
			await expectHeaderLayout(page);
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
			await expect(page.locator('header .description')).toHaveText(description);
			if (width === 360) {
				const lines = await page
					.locator('header .description')
					.evaluate(
						(node) =>
							node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)
					);
				expect(lines).toBe(2);
			}
			if (width === 1280) expect((await searchFrame(page).boundingBox())!.width).toBe(352);
		});
	}
}

test('long branding wraps without displacing tools, including enlarged text and 320px', async ({
	page
}) => {
	await signIn(page, longBrandServer);
	await expect(search(page)).toBeEnabled();
	for (const fontSize of ['100%', '125%', '200%']) {
		await page.evaluate((size) => {
			document.documentElement.style.fontSize = size;
		}, fontSize);
		for (const width of [320, 360, 390, 414, 768, 1280]) {
			await page.setViewportSize({ width, height: 1200 });
			await expectHeaderLayout(page);
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(longTitle);
			await expect(page.locator('header .description')).toHaveText(longDescription);
		}
	}
});

test('no-auth header keeps Theme at the right edge without a reserved sign-out slot', async ({
	page
}) => {
	await page.goto(openServer.url);
	await expect(theme(page)).toBeEnabled();
	for (const width of [320, 360, 390, 414, 768, 1280]) {
		await page.setViewportSize({ width, height: 900 });
		await expectHeaderLayout(page, false);
	}
});

test('Search, Theme, Sign out retain keyboard order, focus and native POST privacy', async ({
	page,
	browser
}) => {
	await page.setViewportSize({ width: 360, height: 900 });
	await signIn(page, protectedServer);
	await page.goto(protectedServer.url);
	await expect(search(page)).toBeEnabled();
	const image = await page.locator('main > header img').elementHandle();
	await page.keyboard.press('Tab');
	await expect(search(page)).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(theme(page)).toBeFocused();
	await expect(theme(page)).toHaveCSS('outline-style', 'solid');
	await page.keyboard.press('Enter');
	await expect(theme(page)).toHaveAccessibleName('Switch to light theme');
	await expect(theme(page)).toBeFocused();
	expect(
		await image!.evaluate((node) => node === document.querySelector('main > header img'))
	).toBe(true);
	await image?.dispose();
	await page.keyboard.press('Tab');
	await expect(signout(page)).toBeFocused();
	await expect(signout(page)).toHaveCSS('outline-style', 'solid');
	const post = page.waitForRequest(
		(request) => request.method() === 'POST' && new URL(request.url()).search === '?/signout'
	);
	await signout(page).click();
	expect((await post).isNavigationRequest()).toBe(true);
	await expect(page).toHaveURL(`${protectedServer.url}/signin?callbackUrl=%2F`);
	expect((await page.request.get(`${protectedServer.url}/__data.json`)).status()).toBe(401);
	const anonymous = await browser.newContext();
	try {
		const response = await anonymous.request.get(`${protectedServer.url}/__data.json`);
		expect(response.status()).toBe(401);
		expect(await response.text()).not.toContain(description);
		await page.reload();
		expect(await page.content()).not.toContain(description);
	} finally {
		await anonymous.close();
	}
});

for (const colorScheme of ['light', 'dark'] as const) {
	test(`without JavaScript, OS ${colorScheme} keeps disabled Theme and native sign-out`, async ({
		browser
	}) => {
		const context = await browser.newContext({
			javaScriptEnabled: false,
			colorScheme,
			viewport: { width: 360, height: 900 }
		});
		try {
			const page = await context.newPage();
			await signIn(page, protectedServer);
			await expect(theme(page)).toBeDisabled();
			await expect(search(page)).toBeDisabled();
			await expectHeaderLayout(page);
			await expect(page.locator('html')).not.toHaveAttribute('data-theme');
			await expect(page.locator('body')).toHaveCSS(
				'background-color',
				colorScheme === 'light' ? 'rgb(245, 245, 245)' : 'rgb(16, 19, 20)'
			);
			await page.goto(protectedServer.url);
			await page.keyboard.press('Tab');
			await expect(signout(page)).toBeFocused();
			const post = page.waitForRequest(
				(request) => request.method() === 'POST' && new URL(request.url()).search === '?/signout'
			);
			await signout(page).click();
			expect((await post).isNavigationRequest()).toBe(true);
			await expect(page).toHaveURL(`${protectedServer.url}/signin?callbackUrl=%2F`);
			expect((await context.request.get(`${protectedServer.url}/__data.json`)).status()).toBe(401);
			expect(await page.content()).not.toContain(description);
		} finally {
			await context.close();
		}
	});
}
