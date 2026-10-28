import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import {
	configuration,
	credentialsAuth,
	oidcAuth,
	password,
	privateSentinels,
	siteTitle,
	username
} from './support/configuration.js';
import { startIssuer } from './support/oidc-issuer.js';
import { startServer, type TestServer } from './support/server.js';

const logoSource = '/public/PRIVATE_SELECTED_LOGO.svg';
const faviconSource = '/public/PRIVATE_TAB_ICON.svg';
const logo =
	'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#abcdef"/></svg>';
const favicon =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7"/></svg>';
let publicDir: string;

function brandedConfiguration(auth = credentialsAuth, source = logoSource) {
	return configuration(auth).replace(
		`  title: ${JSON.stringify(siteTitle)}`,
		`  title: ${JSON.stringify(siteTitle)}\n  logo_path: ${source}\n  favicon_path: ${faviconSource}`
	);
}

// Sign-in HTML/data must omit configured image paths.
function expectPrivate(text: string, app: TestServer) {
	for (const value of [
		...privateSentinels,
		logoSource,
		faviconSource,
		app.path,
		publicDir,
		logo,
		favicon
	]) {
		expect(text).not.toContain(value);
	}
}

async function expectDecoded(image: Locator, source: string) {
	await expect(image).toHaveAttribute('src', source);
	await expect
		.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0);
	await image.evaluate((node) => (node as HTMLImageElement).decode());
}

test.setTimeout(60_000);

test.beforeEach(async () => {
	publicDir = await mkdtemp(join(tmpdir(), 'directory-signin-'));
	await writeFile(join(publicDir, 'PRIVATE_SELECTED_LOGO.svg'), logo);
	await writeFile(join(publicDir, 'PRIVATE_TAB_ICON.svg'), favicon);
});

test.afterEach(async () => {
	await rm(publicDir, { recursive: true, force: true });
});

test('desktop credentials form supports password managers and keyboard navigation without leaking private data', async ({
	browser
}) => {
	const app = await startServer({ configuration: brandedConfiguration(), publicDir });
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	try {
		await app.ready();
		const page = await context.newPage();
		await page.goto(`${app.url}/signin?error=PRIVATE_RAW_SDK_ERROR`);
		expect(await page.title()).toContain(siteTitle);
		await expect(page.getByRole('heading', { level: 1 })).toContainText(siteTitle);
		await expectDecoded(page.locator('header img'), '/logo');
		await expect(page.getByRole('alert')).toBeVisible();
		expect(await page.content()).not.toContain('PRIVATE_RAW_SDK_ERROR');

		const usernameInput = page.getByRole('textbox', { name: 'Username' });
		const passwordInput = page.getByLabel('Password');
		await expect(usernameInput).toHaveAttribute('autocomplete', 'username');
		await expect(passwordInput).toHaveAttribute('type', 'password');
		await expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
		await expect(usernameInput).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(passwordInput).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();

		for (const path of [
			'/signin?error=PRIVATE_RAW_SDK_ERROR',
			'/signin/__data.json?x-sveltekit-invalidated=11&error=PRIVATE_RAW_SDK_ERROR'
		]) {
			const response = await app.fetch(path);
			expect(response.status).toBe(200);
			const text = await response.text();
			expectPrivate(text, app);
			expect(text).not.toContain('PRIVATE_RAW_SDK_ERROR');
			for (const alias of ['/logo', '/favicon']) expect(text).toContain(alias);
		}
	} finally {
		await context.close();
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});

test('mobile SSO form is keyboard accessible without exposing provider or private data', async ({
	browser
}) => {
	const issuer = await startIssuer();
	const app = await startServer({
		configuration: brandedConfiguration(oidcAuth(issuer.origin)),
		publicDir
	});
	const context = await browser.newContext({
		viewport: { width: 360, height: 800 },
		hasTouch: true,
		isMobile: true
	});
	try {
		await app.ready();
		const page = await context.newPage();
		await page.goto(`${app.url}/signin?error=PRIVATE_RAW_SDK_ERROR`);
		await expect(page.getByRole('heading', { level: 1 })).toContainText(siteTitle);
		await expectDecoded(page.locator('header img'), '/logo');
		await expect(page.getByRole('alert')).toBeVisible();
		const html = await page.content();
		expect(html).not.toContain('PRIVATE_RAW_SDK_ERROR');
		expect(html).not.toContain(issuer.origin);
		await expect(page.locator('input:not([type="hidden"])')).toHaveCount(0);
		expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Sign in with single sign-on' })).toBeFocused();

		for (const path of ['/signin', '/signin/__data.json?x-sveltekit-invalidated=11']) {
			const response = await app.fetch(path);
			expect(response.status).toBe(200);
			const text = await response.text();
			expectPrivate(text, app);
			expect(text).not.toContain(issuer.origin);
		}
	} finally {
		await context.close();
		expect(await app.stop()).toEqual({ code: 0, signal: null });
		await issuer.stop();
	}
});

test('a wide touch device leaves sign-in focus to the user', async ({ browser }) => {
	const app = await startServer({ configuration: brandedConfiguration(), publicDir });
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		hasTouch: true,
		isMobile: true
	});
	try {
		await app.ready();
		const page = await context.newPage();
		await page.goto(`${app.url}/signin?error=credentials`);
		await expectDecoded(page.locator('header img'), '/logo');
		await expect(page.getByRole('alert')).toBeVisible();
		expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(false);
		expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
		await page.keyboard.press('Tab');
		await expect(page.getByLabel('Username')).toBeFocused();
	} finally {
		await context.close();
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});

test('native keyboard wrong password, callback sign-in and sign-out work without JavaScript', async ({
	browser
}) => {
	const app = await startServer({ configuration: brandedConfiguration(), publicDir });
	const context = await browser.newContext({
		javaScriptEnabled: false,
		viewport: { width: 1280, height: 900 }
	});
	try {
		await app.ready();
		const page = await context.newPage();
		await page.goto(`${app.url}/signin?callbackUrl=%2F%3Flink%3Dhousehold`);
		expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
		await page.keyboard.press('Tab');
		await expect(page.getByLabel('Username')).toBeFocused();
		await page.keyboard.type(username);
		await page.keyboard.press('Tab');
		await page.keyboard.type('wrong-password');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page.locator('form')).toHaveAttribute('method', 'POST');
		await page.keyboard.press('Tab');
		await expect(page.getByLabel('Username')).toBeFocused();
		await page.keyboard.type(username);
		await page.keyboard.press('Tab');
		await page.keyboard.type(password);
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(`${app.url}/?link=household`);
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page).toHaveURL(`${app.url}/signin?callbackUrl=%2F`);
		await expectDecoded(page.locator('header img'), '/logo');
		expect((await app.fetch('/__data.json?x-sveltekit-invalidated=11')).status).toBe(401);
	} finally {
		await context.close();
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});

test('sign-in catches a logo failure before hydration and stops after a failed fallback', async ({
	page
}) => {
	const app = await startServer({
		configuration: brandedConfiguration(credentialsAuth, '/public/missing.svg'),
		publicDir
	});
	try {
		await app.ready();
		let releaseScript!: () => void;
		const scripts = new Promise<void>((resolve) => {
			releaseScript = resolve;
		});
		await page.route('**/_app/**/*.js', async (route) => {
			await scripts;
			await route.continue();
		});
		await page.goto(`${app.url}/signin`, { waitUntil: 'commit' });
		const image = page.locator('header img');
		await expect(image).toHaveAttribute('src', '/logo');
		await expect(image).toHaveJSProperty('complete', true);
		await expect(image).toHaveJSProperty('naturalWidth', 0);
		releaseScript();
		await expectDecoded(image, '/favicon.png');
		await page.unroute('**/_app/**/*.js');
		// Install the native-error observer before hydration. Allow the error handler and
		// Svelte's render microtasks to settle across browser frames before counting retries.
		await page.addInitScript(() => {
			document.addEventListener(
				'error',
				(event) => {
					if (
						event.target instanceof HTMLImageElement &&
						event.target.getAttribute('src') === '/favicon.png'
					) {
						requestAnimationFrame(() => {
							requestAnimationFrame(() => {
								document.documentElement.dataset.fallbackErrorSettled = 'true';
							});
						});
					}
				},
				true
			);
		});
		let fallbackRequests = 0;
		await page.route('**/favicon.png', async (route) => {
			fallbackRequests++;
			await route.abort();
		});
		await Promise.all([
			page.waitForEvent(
				'requestfailed',
				(request) => new URL(request.url()).pathname === '/favicon.png'
			),
			page.reload()
		]);
		await expect(image).toHaveAttribute('src', '/favicon.png');
		await expect(image).toHaveJSProperty('complete', true);
		await expect(image).toHaveJSProperty('naturalWidth', 0);
		await expect(page.locator('html')).toHaveAttribute('data-fallback-error-settled', 'true');
		expect(fallbackRequests).toBe(1);
	} finally {
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});
