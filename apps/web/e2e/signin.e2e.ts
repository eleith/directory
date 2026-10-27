import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const otherSource = '/public/PRIVATE_OTHER_IMAGE.svg';
const faviconSource = '/public/PRIVATE_TAB_ICON.svg';
const logo =
	'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#abcdef"/></svg>';
const favicon =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7"/></svg>';
const light = '#abc';
const dark = '#13579b';
let publicDir: string;

function brandedConfiguration(auth = credentialsAuth, source: string | null = logoSource) {
	let logoField = '';
	if (source !== null) logoField = `\n  logo_path: ${source}`;
	return (
		configuration(auth).replace(
			`  title: ${JSON.stringify(siteTitle)}`,
			`  title: ${JSON.stringify(siteTitle)}${logoField}\n  favicon_path: ${faviconSource}`
		) +
		`appearance:
  primary_light_color: '${light}'
  primary_dark_color: '${dark}'
`
	);
}

function expectPrivate(text: string, app: TestServer) {
	for (const value of [
		...privateSentinels,
		logoSource,
		otherSource,
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

function contrast(foreground: string, background: string) {
	function luminance(rgb: string) {
		const channels = rgb
			.match(/[\d.]+/g)!
			.slice(0, 3)
			.map((value) => {
				const channel = Number(value) / 255;
				return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
			});
		return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
	}
	const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
	return (values[1]! + 0.05) / (values[0]! + 0.05);
}

test.setTimeout(60_000);

test.beforeEach(async () => {
	publicDir = await mkdtemp(join(tmpdir(), 'directory-signin-'));
	await writeFile(join(publicDir, 'PRIVATE_SELECTED_LOGO.svg'), logo);
	await writeFile(join(publicDir, 'PRIVATE_OTHER_IMAGE.svg'), favicon);
	await writeFile(join(publicDir, 'PRIVATE_TAB_ICON.svg'), favicon);
});

test.afterEach(async () => {
	await rm(publicDir, { recursive: true, force: true });
});

for (const strategy of ['credentials', 'sso'] as const) {
	for (const width of [360, 1280]) {
		for (const colorScheme of ['light', 'dark'] as const) {
			test(`${strategy} presentation at ${width}px in ${colorScheme}`, async ({ browser }) => {
				const issuer = strategy === 'sso' ? await startIssuer() : undefined;
				let auth = credentialsAuth;
				if (issuer) auth = oidcAuth(issuer.origin);
				const app = await startServer({ configuration: brandedConfiguration(auth), publicDir });
				const context = await browser.newContext({
					viewport: { width, height: 900 },
					hasTouch: width === 360,
					isMobile: width === 360,
					colorScheme,
					reducedMotion: 'reduce'
				});
				try {
					await app.ready();
					const page = await context.newPage();
					await page.goto(`${app.url}/signin?error=PRIVATE_RAW_SDK_ERROR`);
					await expect(page).toHaveTitle(`Sign in — ${siteTitle}`);
					await expect(page.getByRole('heading', { level: 1 })).toHaveText(
						`Sign in to ${siteTitle}`
					);
					await expectDecoded(page.locator('header img'), '/logo');
					await expect(page.locator('header img')).toHaveAttribute('width', '48');
					await expect(page.locator('header img')).toHaveAttribute('height', '48');
					await expect(page.locator('header img')).toHaveCSS('width', '48px');
					await expect(page.locator('header img')).toHaveCSS('height', '48px');
					await expect(page.getByRole('alert')).toHaveText('Unable to sign in. Please try again.');
					expect(await page.content()).not.toContain('PRIVATE_RAW_SDK_ERROR');
					await expect(page.getByRole('alert')).toHaveCSS('border-top-style', 'solid');
					await expect(page.getByRole('alert')).toHaveCSS(
						'background-color',
						colorScheme === 'light' ? 'rgb(254, 242, 242)' : 'rgb(69, 10, 10)'
					);
					const button = page.getByRole('button');
					await expect(button).toHaveCSS(
						'background-color',
						colorScheme === 'light' ? 'rgb(170, 187, 204)' : 'rgb(19, 87, 155)'
					);
					const colors = await button.evaluate((node) => ({
						foreground: getComputedStyle(node).color,
						background: getComputedStyle(node).backgroundColor
					}));
					expect(contrast(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
					for (const input of await page.locator('input:not([type="hidden"])').all()) {
						expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
					}
					expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
					for (const frame of await page.locator('.ui-input').all()) {
						expect((await frame.boundingBox())!.height).toBeGreaterThanOrEqual(48);
					}
					await expect(page.locator('[autofocus]')).toHaveCount(0);
					await expect(page.locator('body')).toHaveCSS('font-size', '16px');
					await expect(page.locator('body')).toHaveCSS(
						'background-color',
						colorScheme === 'light' ? 'rgb(245, 245, 245)' : 'rgb(16, 19, 20)'
					);
					await expect(page.locator('main')).toHaveCSS('animation-name', 'none');
					if (width === 360) {
						await expect(page.locator('main')).toHaveCSS('border-top-width', '0px');
						await expect(page.locator('main')).toHaveCSS('box-shadow', 'none');
						expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
						await page.keyboard.press('Tab');
					} else {
						await expect(page.locator('main')).toHaveCSS('border-top-width', '1px');
						const card = await page.locator('main').boundingBox();
						expect(card!.width).toBe(400);
						expect(Math.abs(card!.x + card!.width / 2 - width / 2)).toBeLessThan(1);
						expect(Math.abs(card!.y + card!.height / 2 - 450)).toBeLessThan(1);
					}
					if (strategy === 'credentials') {
						await expect(page.getByLabel('Username')).toBeFocused();
						await expect(page.getByLabel('Username')).toHaveAttribute('autocomplete', 'username');
						await expect(page.getByLabel('Password')).toHaveAttribute(
							'autocomplete',
							'current-password'
						);
						await page.keyboard.press('Tab');
						await expect(page.getByLabel('Password')).toBeFocused();
						await page.keyboard.press('Tab');
					} else {
						await expect(
							page.getByText('Use your single sign-on account to access the directory.')
						).toBeVisible();
						await expect(button).toHaveText('Sign in with single sign-on');
						await expect(page.locator('input:not([type="hidden"])')).toHaveCount(0);
						expect(await page.content()).not.toContain(issuer!.origin);
					}
					await expect(button).toBeFocused();
					await expect(button).toHaveCSS('outline-style', 'solid');
					await expect(button).toHaveCSS('outline-color', colors.foreground);
					await expect(button).toHaveCSS('outline-offset', '-2px');
					await button.hover();
					await expect(button).toHaveCSS('box-shadow', 'none');
					await expect(button).toHaveCSS('background-color', colors.background);
					await page.mouse.down();
					await expect(button).toHaveCSS(
						'box-shadow',
						`${colors.foreground} 0px 0px 0px 3px inset`
					);
					await page.mouse.move(0, 0);
					await page.mouse.up();
					await expect(button).toHaveCSS('background-color', colors.background);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
					).toBe(true);
					for (const path of ['/signin', '/signin/__data.json?x-sveltekit-invalidated=11']) {
						const response = await app.fetch(path);
						expect(response.status).toBe(200);
						const text = await response.text();
						expectPrivate(text, app);
						for (const value of ['/logo', '/favicon']) expect(text).toContain(value);
						if (path === '/signin') {
							expect(text).toContain(
								`<style>:root{--color-primary:light-dark(${light},${dark});--color-on-primary:light-dark(#171717,#f5f5f5)}</style>`
							);
						} else {
							expect(text).not.toContain('--color-primary');
						}
					}
				} finally {
					await context.close();
					expect(await app.stop()).toEqual({ code: 0, signal: null });
					if (issuer) await issuer.stop();
				}
			});
		}
	}
}

test('a wide touch device does not autofocus, and credential errors use the same banner', async ({
	browser
}) => {
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
		await expect(page.getByRole('alert')).toHaveText(
			'Invalid username or password. Please try again.'
		);
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
		await expect(page.getByRole('alert')).toHaveText('Unable to sign in. Please try again.');
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

test('only selected logo bytes are public, with independent favicon and no arbitrary selectors', async () => {
	const selectedAlsoBookmark = brandedConfiguration().replace(
		'    title: PRIVATE_C6_SERVICE\n',
		`    logo_path: ${logoSource}\n    title: PRIVATE_C6_SERVICE\n`
	);
	const app = await startServer({ configuration: selectedAlsoBookmark, publicDir });
	try {
		await app.ready();
		for (const method of ['GET', 'HEAD']) {
			for (const path of ['/logo', '/logo?file=/public/PRIVATE_OTHER_IMAGE.svg&root=/outside']) {
				const response = await app.fetch(path, { method, headers: { accept: 'text/html' } });
				expect(response.status).toBe(200);
				expect(response.headers.get('cache-control')).toBe('private, no-store');
				expect(response.headers.get('x-content-type-options')).toBe('nosniff');
				expect(response.headers.get('content-type')).toBe('image/svg+xml');
				expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(logo)));
				expect(await response.text()).toBe(method === 'HEAD' ? '' : logo);
			}
			for (const path of [logoSource, otherSource, faviconSource, '/bookmarks/household/logo']) {
				const response = await app.fetch(path, { method, headers: { accept: 'text/html' } });
				expect(response.status).toBe(401);
				expectPrivate(await response.text(), app);
			}
		}
		expect(
			(
				await app.fetch('/logo/PRIVATE_OTHER_IMAGE.svg', {
					headers: { accept: 'application/json' }
				})
			).status
		).toBe(401);
		expect(await (await app.fetch('/favicon')).text()).toBe(favicon);
		await writeFile(join(publicDir, 'PRIVATE_SELECTED_LOGO.svg'), favicon);
		expect(await (await app.fetch('/logo')).text()).toBe(favicon);
		await writeFile(join(publicDir, 'PRIVATE_OTHER_IMAGE.svg'), logo);
		await app.replace(brandedConfiguration(credentialsAuth, otherSource));
		await expect.poll(async () => (await app.fetch('/logo')).text()).toBe(logo);
		await app.replace('site: [invalid');
		await expect.poll(() => app.output()).toContain('load_failed');
		expect(await (await app.fetch('/logo')).text()).toBe(logo);
		await app.replace(brandedConfiguration(credentialsAuth, null));
		await expect.poll(async () => (await app.fetch('/logo')).status).toBe(404);
		for (const method of ['GET', 'HEAD']) {
			const response = await app.fetch('/logo', { method });
			expect(response.status).toBe(404);
			expect(await response.text()).toBe(method === 'HEAD' ? '' : 'Not found');
		}
		expect(await (await app.fetch('/favicon')).text()).toBe(favicon);
	} finally {
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});

for (const { source, javaScriptEnabled } of [
	{ source: null, javaScriptEnabled: false },
	{ source: '/public/missing.svg', javaScriptEnabled: false },
	{ source: '/public/missing.svg', javaScriptEnabled: true }
]) {
	test(`${source ?? 'bundled default'} logo with JavaScript ${javaScriptEnabled}`, async ({
		browser
	}) => {
		const app = await startServer({
			configuration: brandedConfiguration(credentialsAuth, source),
			publicDir
		});
		const context = await browser.newContext({
			javaScriptEnabled,
			viewport: { width: 360, height: 800 }
		});
		try {
			await app.ready();
			const page = await context.newPage();
			let logoRequests = 0;
			page.on('request', (request) => {
				if (new URL(request.url()).pathname === '/logo') logoRequests++;
			});
			await page.goto(`${app.url}/signin`);
			const image = page.locator('header img');
			if (source !== null && !javaScriptEnabled) {
				await expect(image).toHaveAttribute('src', '/logo');
				await expect(image).toHaveJSProperty('complete', true);
				await expect(image).toHaveJSProperty('naturalWidth', 0);
			} else await expectDecoded(image, '/favicon.png');
			expect(logoRequests).toBe(source === null ? 0 : 1);
			await expect(page.getByRole('heading')).toHaveText(`Sign in to ${siteTitle}`);
			await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
			await expect(page.locator('head link[rel="icon"]')).toHaveJSProperty(
				'href',
				`${app.url}/favicon`
			);
			expect(Buffer.from(await (await app.fetch('/favicon.png')).arrayBuffer())).toEqual(
				await readFile(new URL('../static/favicon.png', import.meta.url))
			);
			expect((await app.fetch('/logo')).status).toBe(404);
		} finally {
			await context.close();
			expect(await app.stop()).toEqual({ code: 0, signal: null });
		}
	});
}

test('sign-in catches a logo failure before hydration and stops after a failed fallback', async ({
	page
}) => {
	const app = await startServer({
		configuration: brandedConfiguration(credentialsAuth, '/public/missing.svg'),
		publicDir
	});
	try {
		await app.ready();
		await page.route('**/_app/**/*.js', (route) => route.abort());
		await page.goto(`${app.url}/signin`);
		const image = page.locator('header img');
		await expect(image).toHaveAttribute('src', '/logo');
		await expect(image).toHaveJSProperty('complete', true);
		await expect(image).toHaveJSProperty('naturalWidth', 0);
		await page.unroute('**/_app/**/*.js');
		let releaseScript!: () => void;
		const scripts = new Promise<void>((resolve) => {
			releaseScript = resolve;
		});
		await page.route('**/_app/**/*.js', async (route) => {
			await scripts;
			await route.continue();
		});
		const navigation = page.goto(`${app.url}/signin`, { waitUntil: 'commit' });
		await navigation;
		await expect(image).toHaveAttribute('src', '/logo');
		await expect(image).toHaveJSProperty('complete', true);
		await expect(image).toHaveJSProperty('naturalWidth', 0);
		releaseScript();
		await expectDecoded(image, '/favicon.png');
		await page.unroute('**/_app/**/*.js');
		let fallbackRequests = 0;
		await page.route('**/favicon.png', async (route) => {
			fallbackRequests++;
			await route.abort();
		});
		await page.reload();
		await expect(image).toHaveAttribute('src', '/favicon.png');
		await expect(image).toHaveJSProperty('complete', true);
		await expect(image).toHaveJSProperty('naturalWidth', 0);
		await page.waitForTimeout(200);
		expect(fallbackRequests).toBe(1);
	} finally {
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});
