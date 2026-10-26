import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialsAuth, password, username } from './support/configuration.js';
import { startServer, type TestServer } from './support/server.js';

const configuration = `site:
  title: Theme fixture
  description: Private theme description
  logo_path: /public/private-theme-logo.svg
appearance:
  primary_light_color: '#13579b'
  primary_dark_color: '#e2c4a6'
links:
  calendar:
    title: Household calendar
    url: https://calendar.example.test/
    group: Household
`;
const backgrounds = { light: 'rgb(245, 245, 245)', dark: 'rgb(16, 19, 20)' };
const accents = { light: 'rgb(19, 87, 155)', dark: 'rgb(226, 196, 166)' };
let server: TestServer;
let publicDir: string;

test.beforeAll(async () => {
	publicDir = await mkdtemp(join(tmpdir(), 'directory-theme-'));
	await writeFile(
		join(publicDir, 'private-theme-logo.svg'),
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#369" d="M0 0h48v48H0z"/></svg>'
	);
	server = await startServer({ configuration, publicDir });
	await server.ready();
});

test.afterAll(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
	await rm(publicDir, { recursive: true, force: true });
});

async function expectTheme(page: Page, preference: string, applied: 'light' | 'dark') {
	await expect(page.locator('html')).toHaveAttribute('data-theme-preference', preference);
	await expect(page.locator('html')).toHaveAttribute('data-theme', applied);
	await expect(page.locator('body')).toHaveCSS('background-color', backgrounds[applied]);
}

test('keyboard cycle, next-action icons, focus, persistence and Kit navigation', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
			errors.push(message.text());
		}
	});
	await page.emulateMedia({ colorScheme: 'light' });
	await page.setViewportSize({ width: 360, height: 800 });
	await page.goto(server.url);
	const toggle = page.locator('.header-actions button');
	await expect(toggle).toBeEnabled();
	await expectTheme(page, 'system', 'light');
	await expect(toggle).toHaveAccessibleName('Switch to dark theme');
	await expect(toggle.locator('svg.icon-moon')).toBeVisible();
	await expect(toggle.locator('svg')).toHaveAttribute('aria-hidden', 'true');
	await expect(toggle.locator('svg')).toHaveAttribute('focusable', 'false');
	const box = await toggle.boundingBox();
	expect(box!.width).toBeGreaterThanOrEqual(44);
	expect(box!.height).toBeGreaterThanOrEqual(44);
	const headerImage = await page.locator('header img').elementHandle();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(toggle).toBeFocused();
	await expect(toggle).toHaveCSS('outline-style', 'solid');
	await expect(toggle).toHaveCSS('outline-color', accents.light);
	await page.keyboard.press('Enter');
	await expectTheme(page, 'dark', 'dark');
	await expect(toggle).toHaveAccessibleName('Switch to light theme');
	await expect(toggle.locator('svg.icon-sun-dim')).toBeVisible();
	await expect(toggle).toBeFocused();
	await expect(toggle).toHaveCSS('outline-color', accents.dark);
	await page.keyboard.press('Space');
	await expectTheme(page, 'light', 'light');
	await expect(toggle).toHaveAccessibleName('Use system theme');
	await expect(toggle.locator('svg.icon-faders')).toBeVisible();
	await page.keyboard.press('Enter');
	await expectTheme(page, 'system', 'light');
	await toggle.click();
	expect(await page.evaluate(() => localStorage.getItem('directory.theme'))).toBe('dark');
	expect(
		await headerImage!.evaluate((image) => image === document.querySelector('header img'))
	).toBe(true);
	await page.reload();
	await expectTheme(page, 'dark', 'dark');
	await expect(toggle).toHaveAccessibleName('Switch to light theme');
	await page.evaluate(() => {
		document.body.dataset.navigationMarker = 'same-document';
	});
	await page.getByRole('link', { name: 'Household calendar', exact: true }).click();
	await expect(page).toHaveURL(`${server.url}/?link=calendar`);
	await expectTheme(page, 'dark', 'dark');
	const close = page.getByRole('button', { name: 'Close', exact: true });
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(
		page.getByRole('link', { name: 'Open Household calendar (opens in a new tab)', exact: true })
	).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(close).toBeFocused();
	await expect(close).toHaveCSS('outline-style', 'solid');
	await expect(close).toHaveCSS('outline-color', accents.dark);
	await close.click();
	await expect(page).toHaveURL(`${server.url}/`);
	await expectTheme(page, 'dark', 'dark');
	await expect(page.locator('body')).toHaveAttribute('data-navigation-marker', 'same-document');
	expect(errors).toEqual([]);
});

test('System alone follows OS changes; manual palettes and configured accents override the OS', async ({
	page
}) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto(server.url);
	const toggle = page.locator('.header-actions button');
	await expect(toggle).toBeEnabled();
	await page.emulateMedia({ colorScheme: 'dark' });
	await expectTheme(page, 'system', 'dark');
	await page.emulateMedia({ colorScheme: 'light' });
	await expectTheme(page, 'system', 'light');
	await toggle.click();
	await expectTheme(page, 'dark', 'dark');
	const tile = page.locator('a[href="/?link=calendar"]');
	const close = page.getByRole('button', { name: 'Close', exact: true });
	await tile.click();
	await expect(
		page.getByRole('link', { name: 'Open Household calendar (opens in a new tab)', exact: true })
	).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(close).toBeFocused();
	await expect(close).toHaveCSS('outline-style', 'solid');
	await expect(close).toHaveCSS('outline-color', accents.dark);
	await close.click();
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.emulateMedia({ colorScheme: 'light' });
	await expectTheme(page, 'dark', 'dark');
	await toggle.click();
	await page.emulateMedia({ colorScheme: 'dark' });
	await expectTheme(page, 'light', 'light');
	await tile.click();
	await expect(
		page.getByRole('link', { name: 'Open Household calendar (opens in a new tab)', exact: true })
	).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(close).toBeFocused();
	await expect(close).toHaveCSS('outline-style', 'solid');
	await expect(close).toHaveCSS('outline-color', accents.light);
	await close.click();
	await toggle.focus();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await expect(toggle).toBeFocused();
	await expect(toggle).toHaveCSS('outline-color', accents.light);
	await toggle.click();
	await expectTheme(page, 'system', 'dark');
	await page.emulateMedia({ colorScheme: 'light' });
	await expectTheme(page, 'system', 'light');
});

for (const saved of ['dark', 'light', 'system']) {
	test(`prepaint bootstrap restores ${saved} with hydration withheld under native CSP`, async ({
		page
	}) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.addInitScript(
			(preference) => localStorage.setItem('directory.theme', preference),
			saved
		);
		await page.route('**/_app/**/*.js', (route) => route.abort());
		const response = await page.goto(server.url);
		const applied = saved === 'light' ? 'light' : 'dark';
		await expectTheme(page, saved, applied);
		await expect(page.locator('.header-actions button')).toBeDisabled();
		const html = await response!.text();
		expect(html.indexOf('directory.theme')).toBeLessThan(html.indexOf('rel="stylesheet"'));
		const nonce = /<script nonce="([^"]+)"/.exec(html)?.[1];
		expect(nonce).toBeTruthy();
		const policy = response!.headers()['content-security-policy'];
		if (!policy) throw new Error('Expected a Content-Security-Policy response header');
		const scripts = policy
			.split(';')
			.find((directive) => directive.trim().startsWith('script-src'))!;
		expect(scripts).toContain(`'nonce-${nonce}'`);
		expect(scripts).not.toContain("'unsafe-inline'");
		expect(policy).toContain("object-src 'none'");
		expect(policy).toContain("frame-ancestors 'none'");
		await page.evaluate(() => {
			const script = document.createElement('script');
			script.textContent = 'document.documentElement.dataset.untrustedScript = "ran"';
			document.head.append(script);
		});
		await expect(page.locator('html')).not.toHaveAttribute('data-untrusted-script');
	});
}

test('invalid raw preferences fall back to System', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto(server.url);
	for (const raw of ['DARK', '"light"', '', 'invalid']) {
		await page.evaluate((value) => localStorage.setItem('directory.theme', value), raw);
		await page.reload();
		await expectTheme(page, 'system', 'dark');
		await expect(
			page.getByRole('button', { name: 'Switch to dark theme', exact: true })
		).toBeEnabled();
	}
});

for (const blocked of ['getItem', 'setItem'] as const) {
	test(`blocked storage ${blocked} leaves the in-memory cycle and System listener usable`, async ({
		page
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.emulateMedia({ colorScheme: 'light' });
		await page.addInitScript((method) => {
			Storage.prototype[method] = () => {
				throw new DOMException('Blocked', 'SecurityError');
			};
		}, blocked);
		await page.goto(server.url);
		const toggle = page.locator('.header-actions button');
		await expect(toggle).toBeEnabled();
		await expectTheme(page, 'system', 'light');
		await toggle.click();
		await expectTheme(page, 'dark', 'dark');
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.emulateMedia({ colorScheme: 'light' });
		await expectTheme(page, 'dark', 'dark');
		await toggle.click();
		await expectTheme(page, 'light', 'light');
		await toggle.click();
		await expectTheme(page, 'system', 'light');
		await page.emulateMedia({ colorScheme: 'dark' });
		await expectTheme(page, 'system', 'dark');
		expect(errors).toEqual([]);
	});
}

for (const colorScheme of ['light', 'dark'] as const) {
	test(`no JavaScript keeps OS ${colorScheme}, disabled toggle and native navigation`, async ({
		browser
	}) => {
		const context = await browser.newContext({ javaScriptEnabled: false, colorScheme });
		try {
			const page = await context.newPage();
			await page.goto(server.url);
			await expect(page.locator('html')).not.toHaveAttribute('data-theme');
			await expect(page.locator('body')).toHaveCSS('background-color', backgrounds[colorScheme]);
			await expect(page.locator('.header-actions button')).toBeDisabled();
			await page.keyboard.press('Tab');
			const tile = page.getByRole('link', { name: 'Household calendar', exact: true });
			await expect(tile).toBeFocused();
			await tile.click();
			await expect(page).toHaveURL(`${server.url}/?link=calendar`);
			const back = page.getByRole('link', { name: 'Back to directory', exact: true });
			await expect(back).toHaveCSS('text-decoration-color', accents[colorScheme]);
			await back.click();
			await expect(page).toHaveURL(`${server.url}/`);
		} finally {
			await context.close();
		}
	});
}

test('saved theme on public sign-in and sign-out retains the public configured accents', async ({
	page
}) => {
	const protectedServer = await startServer({
		configuration: configuration + credentialsAuth,
		publicDir
	});
	const errors: string[] = [];
	try {
		await protectedServer.ready();
		await page.emulateMedia({ colorScheme: 'light' });
		await page.addInitScript(() => {
			if (localStorage.getItem('directory.theme') === null)
				localStorage.setItem('directory.theme', 'dark');
		});
		for (const path of ['/signin', '/signin/__data.json', '/__data.json']) {
			const response = await protectedServer.fetch(path);
			expect(response.status).toBe(path === '/__data.json' ? 401 : 200);
			const text = await response.text();
			if (path === '/signin') {
				expect(text).toContain('--color-primary:light-dark(#13579b,#e2c4a6)');
			} else {
				expect(text).not.toContain('--color-primary');
			}
			for (const value of [
				'Private theme description',
				'/public/private-theme-logo.svg',
				username,
				password
			]) {
				expect(text).not.toContain(value);
			}
		}
		await page.route('**/_app/**/*.js', (route) => route.abort());
		await page.goto(protectedServer.url);
		await expect(page).toHaveURL(`${protectedServer.url}/signin?callbackUrl=%2F`);
		await expectTheme(page, 'dark', 'dark');
		await expect(page.getByRole('button', { name: 'Switch to light theme' })).toHaveCount(0);
		await expect(page.locator('header img')).toHaveAttribute('src', '/logo');
		await page.unroute('**/_app/**/*.js');
		await page.reload();
		page.on('pageerror', (error) => errors.push(error.message));
		await expectTheme(page, 'dark', 'dark');
		await expect(page.getByLabel('Username')).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.getByLabel('Password')).toBeFocused();
		await expect(page.getByLabel('Password').locator('..')).toHaveCSS(
			'outline-color',
			accents.dark
		);
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		const toggle = page.getByRole('button', { name: 'Switch to light theme', exact: true });
		await expect(toggle).toBeEnabled();
		await expectTheme(page, 'dark', 'dark');
		await page.setViewportSize({ width: 360, height: 800 });
		await toggle.focus();
		await expect(toggle).toHaveCSS('outline-color', accents.dark);
		await page.keyboard.press('Tab');
		const signout = page.getByRole('button', { name: 'Sign out', exact: true });
		await expect(signout).toBeFocused();
		await expect(signout).toBeInViewport();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await signout.click();
		await expect(page).toHaveURL(`${protectedServer.url}/signin?callbackUrl=%2F`);
		await expectTheme(page, 'dark', 'dark');
		await page.getByLabel('Username').focus();
		await expect(page.getByLabel('Username').locator('..')).toHaveCSS(
			'outline-color',
			accents.dark
		);
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await toggle.click();
		await page.getByRole('button', { name: 'Use system theme', exact: true }).click();
		await expectTheme(page, 'system', 'light');
		await signout.click();
		await expect(page).toHaveURL(`${protectedServer.url}/signin?callbackUrl=%2F`);
		await expectTheme(page, 'system', 'light');
		await page.evaluate(() => {
			document.body.dataset.navigationMarker = 'signed-out';
		});
		await page.emulateMedia({ colorScheme: 'dark' });
		await expectTheme(page, 'system', 'dark');
		await page.emulateMedia({ colorScheme: 'light' });
		await expectTheme(page, 'system', 'light');
		await expect(page.locator('body')).toHaveAttribute('data-navigation-marker', 'signed-out');
		expect(errors).toEqual([]);
	} finally {
		expect(await protectedServer.stop()).toEqual({ code: 0, signal: null });
	}
});
