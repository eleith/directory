import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialsAuth, oidcAuth, password, username } from './support/configuration.js';
import { clientManifest, directoryScript } from './support/details.js';
import { startIssuer } from './support/oidc-issuer.js';
import { startServer, type TestServer } from './support/server.js';

const destinationURL = 'https://controls.example.test/archive?from=directory#latest';
const literalTag = 'family photos: 2026';
const configuration = `site:
  title: Shared controls fixture
appearance:
  primary_light_color: '#13579b'
  primary_dark_color: '#e2c4a6'
links:
  archive:
    title: Controls archive
    url: ${destinationURL}
    logo_path: /public/controls-logo.svg
    tags: [${JSON.stringify(literalTag)}]
    requires_auth: true
  notebook:
    title: Controls notebook
    url: https://controls.example.test/notebook
`;
const hoverBackground = 'color-mix(in srgb, var(--color-text) 8%, var(--color-surface-card))';
const focusBackground = 'color-mix(in srgb, var(--color-primary) 16%, var(--color-surface-card))';
const pressedBackground = 'color-mix(in srgb, var(--color-primary) 24%, var(--color-surface-card))';
let server: TestServer;
let publicDir: string;

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search', exact: true });
const openAction = (page: Page) =>
	page.getByRole('link', { name: 'Open Controls archive (opens in a new tab)', exact: true });

async function expectBackground(control: Locator, expression: string) {
	await expect
		.poll(() =>
			control.evaluate((node, expression) => {
				const probe = document.createElement('span');
				probe.style.display = 'none';
				probe.style.background = expression;
				node.append(probe);
				const canvas = document.createElement('canvas').getContext('2d')!;
				function rgb(color: string) {
					canvas.clearRect(0, 0, 1, 1);
					canvas.fillStyle = color;
					canvas.fillRect(0, 0, 1, 1);
					return [...canvas.getImageData(0, 0, 1, 1).data];
				}
				const actual = rgb(getComputedStyle(node).backgroundColor);
				const expected = rgb(getComputedStyle(probe).backgroundColor);
				probe.remove();
				return actual.every((channel, index) => channel === expected[index]);
			}, expression)
		)
		.toBe(true);
}

async function expectInsetFocus(control: Locator, color: string) {
	await expect(control).toHaveCSS('outline-style', 'solid');
	await expect(control).toHaveCSS('outline-width', '2px');
	await expect(control).toHaveCSS('outline-offset', '-2px');
	await expect(control).toHaveCSS('outline-color', color);
	await expect(control).toHaveCSS('box-shadow', 'none');
}

async function expectSharedControls(page: Page) {
	for (const button of await page.locator('button:visible').all()) {
		await expect(button).toHaveClass(/\bui-button\b/);
		await expect(button).toHaveJSProperty('tagName', 'BUTTON');
		const box = (await button.boundingBox())!;
		let minimum = 48;
		if (await button.evaluate((node) => node.matches('.ui-button--icon'))) {
			minimum = 44;
		}
		if (
			await button.evaluate((node) => node.matches('.ui-button--chip, .ui-button--access-chip'))
		) {
			minimum = 24;
		}
		expect(box.width).toBeGreaterThanOrEqual(minimum);
		expect(box.height).toBeGreaterThanOrEqual(minimum);
	}
	for (const input of await page.locator('input:visible').all()) {
		await expect(input).toHaveClass('ui-input__control');
		await expect(input.locator('..')).toHaveClass(/\bui-input\b/);
		expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		expect((await input.locator('..').boundingBox())!.height).toBeGreaterThanOrEqual(48);
	}
	for (const action of await page.locator('.open-service:visible').all()) {
		await expect(action).toHaveJSProperty('tagName', 'A');
		await expect(action).toHaveClass(/\bui-button--primary\b/);
		const box = (await action.boundingBox())!;
		expect(box.height).toBeGreaterThanOrEqual(48);
		expect(box.width).toBeGreaterThanOrEqual(80);
	}
}

async function primaryColors(control: Locator) {
	return control.evaluate((node) => {
		const canvas = document.createElement('canvas').getContext('2d')!;
		function rgb(color: string) {
			canvas.fillStyle = color;
			canvas.fillRect(0, 0, 1, 1);
			return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3);
		}
		const style = getComputedStyle(node);
		return { foreground: rgb(style.color), background: rgb(style.backgroundColor) };
	});
}

function contrast(colors: Awaited<ReturnType<typeof primaryColors>>) {
	function luminance(channels: number[]) {
		const linear = channels.map((channel) => {
			const value = channel / 255;
			if (value <= 0.04045) return value / 12.92;
			return ((value + 0.055) / 1.055) ** 2.4;
		});
		return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
	}
	const foreground = luminance(colors.foreground);
	const background = luminance(colors.background);
	return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
}

async function expectPrimaryStates(page: Page, control: Locator) {
	await expect(control).toBeFocused();
	const box = await control.boundingBox();
	const colors = await primaryColors(control);
	const palette = await control.evaluate((node) => {
		const probe = document.createElement('span');
		probe.style.display = 'none';
		probe.style.color = 'var(--color-on-primary)';
		probe.style.boxShadow = 'inset 0 0 0 1px var(--color-on-primary), var(--shadow-card)';
		node.append(probe);
		const style = getComputedStyle(probe);
		const palette = { foreground: style.color, hoverShadow: style.boxShadow };
		probe.remove();
		return palette;
	});
	const foreground = palette.foreground;
	await expect(control).toHaveCSS('color', foreground);
	await expectBackground(control, 'var(--color-primary)');
	expect(contrast(colors)).toBeGreaterThanOrEqual(4.5);
	await expectInsetFocus(control, foreground);
	await page.keyboard.press('Shift+Tab');
	await page.mouse.move(0, 0);
	await expect(control).not.toBeFocused();
	expect(await primaryColors(control)).toEqual(colors);
	await expect(control).toHaveCSS('box-shadow', 'none');
	await control.hover();
	expect(await primaryColors(control)).toEqual(colors);
	await expect(control).toHaveCSS('box-shadow', palette.hoverShadow);
	await page.mouse.down();
	try {
		await expect(control).toBeFocused();
		expect(await primaryColors(control)).toEqual(colors);
		await expect(control).toHaveCSS('box-shadow', `${foreground} 0px 0px 0px 3px inset`);
		await expect(control).toHaveCSS('outline-style', 'none');
	} finally {
		await page.mouse.move(0, 0);
		await page.mouse.up();
	}
	await expectInsetFocus(control, foreground);
	expect(await primaryColors(control)).toEqual(colors);
	expect(await control.boundingBox()).toEqual(box);
}

test.setTimeout(60_000);

test.beforeAll(async () => {
	publicDir = await mkdtemp(join(tmpdir(), 'directory-ui-controls-'));
	await writeFile(
		join(publicDir, 'controls-logo.svg'),
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#369" d="M0 0h64v64H0z"/></svg>'
	);
	server = await startServer({ configuration, publicDir });
	await server.ready();
});

test.afterAll(async () => {
	try {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	} finally {
		await rm(publicDir, { recursive: true, force: true });
	}
});

test('Search binds the native value/ref; Clear alone owns its focused frame', async ({ page }) => {
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme });
		await page.goto(server.url);
		await expect(search(page)).toBeEnabled();
		const frame = search(page).locator('..');
		const frameBox = await frame.boundingBox();
		const nativeBox = await search(page).boundingBox();
		const accent = colorScheme === 'light' ? 'rgb(19, 87, 155)' : 'rgb(226, 196, 166)';
		const engineScript = '/' + clientManifest['src/lib/search/engine.ts']!.file;
		const engineRequest = page.waitForRequest((request) => request.url().endsWith(engineScript));
		const leading = frame.locator('.ui-input__leading');
		await expect(leading).toHaveJSProperty('tagName', 'LABEL');
		await expect(leading).toHaveAttribute('for', 'directory-search');
		await leading.click({ position: { x: 2, y: 2 } });
		await expect(search(page)).toBeFocused();
		await engineRequest;
		await page.getByRole('heading', { name: 'Shared controls fixture', exact: true }).click();
		await expect(search(page)).not.toBeFocused();
		await search(page).hover();
		await expectBackground(frame, hoverBackground);
		await search(page).click();
		await expect(search(page)).toBeFocused();
		await expectBackground(frame, focusBackground);
		await expectInsetFocus(frame, accent);
		await expect(search(page)).toHaveCSS('outline-style', 'none');
		expect(await search(page).boundingBox()).toEqual(nativeBox);
		await search(page).fill('archive');
		await expect(page).toHaveURL(`${server.url}/?q=archive`);
		await expect(page.getByRole('list', { name: 'Search results' }).getByRole('link')).toHaveCount(
			1
		);
		const clear = page.getByRole('button', { name: 'Clear search', exact: true });
		const clearBox = await clear.boundingBox();
		const filledBox = await search(page).boundingBox();
		await page.keyboard.press('Tab');
		await expect(clear).toBeFocused();
		await expectBackground(clear, focusBackground);
		await expectInsetFocus(clear, accent);
		await expect(frame).toHaveCSS('outline-style', 'none');
		await page.keyboard.press('Tab');
		const theme = page.getByRole('button', { name: 'Switch to dark theme', exact: true });
		await expect(theme).toBeFocused();
		await clear.hover();
		await expectBackground(clear, hoverBackground);
		await page.mouse.down();
		try {
			await expectBackground(clear, pressedBackground);
			await expect(frame).toHaveCSS('outline-style', 'none');
		} finally {
			await page.mouse.move(0, 0);
			await page.mouse.up();
		}
		expect(await clear.boundingBox()).toEqual(clearBox);
		expect(await search(page).boundingBox()).toEqual(filledBox);
		expect(await frame.boundingBox()).toEqual(frameBox);
		await page.keyboard.press('Enter');
		await expect(search(page)).toBeFocused();
		await expect(search(page)).toHaveValue('');
		await expect(page).toHaveURL(`${server.url}/`);
		await expect(clear).toHaveCount(0);
		await search(page).fill('archive');
		await page.keyboard.press('Tab');
		await page.keyboard.press('Tab');
		await expect(theme).toBeFocused();
		await page.keyboard.press('Alt+/');
		await expect(search(page)).toBeFocused();
		expect(
			await search(page).evaluate((node: HTMLInputElement) => [
				node.selectionStart,
				node.selectionEnd
			])
		).toEqual([0, 7]);
		await expectSharedControls(page);
	}
});

test('Open preserves contrast in every state and native modifier/middle tabs; Bits Close remains native', async ({
	page,
	context
}) => {
	await context.route('https://controls.example.test/**', (route) =>
		route.fulfill({ contentType: 'text/plain', body: 'Shared control destination' })
	);
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme });
		await page.goto(server.url);
		const tile = page.getByRole('link', { name: 'Controls archive', exact: true });
		await tile.click();
		const dialog = page.getByRole('dialog');
		await expect(openAction(page)).toBeFocused();
		await dialog.evaluate((node) =>
			Promise.all(node.getAnimations().map((animation) => animation.finished))
		);
		await expectSharedControls(page);
		await expectPrimaryStates(page, openAction(page));
		await expect(openAction(page)).toHaveAttribute('href', destinationURL);
		await expect(openAction(page)).toHaveAttribute('target', '_blank');
		await expect(openAction(page)).toHaveAttribute('rel', 'noopener noreferrer');
		for (const options of [
			{ modifiers: ['Control'] as ['Control'] },
			{ button: 'middle' as const }
		]) {
			const popup = context.waitForEvent('page');
			await openAction(page).click(options);
			const opened = await popup;
			await expect(opened).toHaveURL(destinationURL);
			await opened.close();
			await expect(page).toHaveURL(`${server.url}/?link=archive`);
		}
		const close = dialog.getByRole('button', { name: 'Close', exact: true });
		await expect(close).toHaveAttribute('data-dialog-close', '');
		await expect(close).toHaveAttribute('type', 'button');
		await expect(close).toHaveCSS('width', '44px');
		await expect(close).toHaveCSS('height', '44px');
		const closeBox = await close.boundingBox();
		await expectBackground(close, 'var(--color-surface-card)');
		await close.hover();
		await expectBackground(close, hoverBackground);
		await page.keyboard.press('Tab');
		await expect(close).toBeFocused();
		await expectBackground(close, focusBackground);
		await expectInsetFocus(
			close,
			colorScheme === 'light' ? 'rgb(19, 87, 155)' : 'rgb(226, 196, 166)'
		);
		expect(await close.boundingBox()).toEqual(closeBox);
		for (const control of [
			dialog.getByRole('button', { name: 'Filter by access: login', exact: true }),
			dialog.getByRole('button', { name: `Filter by tag: ${literalTag}`, exact: true }),
			dialog.getByRole('textbox', { name: 'Destination', exact: true }),
			openAction(page),
			close
		]) {
			await page.keyboard.press('Tab');
			await expect(control).toBeFocused();
		}
		await close.click();
		await expect(dialog).toHaveCount(0);
		await expect(tile).toBeFocused();
		await tile.press('Enter');
		await expect(openAction(page)).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(tile).toBeFocused();
	}
});

test('destination keeps native geometry and whole-frame states without a leading icon or gutter', async ({
	page
}) => {
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme });
		await page.goto(`${server.url}/?link=archive`);
		await expect(openAction(page)).toBeFocused();
		const dialog = page.getByRole('dialog');
		await dialog.evaluate((node) =>
			Promise.all(node.getAnimations().map((animation) => animation.finished))
		);
		const destination = dialog.getByRole('textbox', { name: 'Destination', exact: true });
		const frame = destination.locator('..');
		await expect(frame.locator('.ui-input__leading, img')).toHaveCount(0);
		await expect(destination).toHaveCSS('padding-inline-start', '12px');
		const primary = dialog.locator('.identity img');
		await expect(primary).toHaveAttribute('src', '/public/controls-logo.svg');
		await expect(primary).toHaveCSS('width', '64px');
		await expect(primary).toHaveCSS('height', '64px');
		await expect
			.poll(() => primary.evaluate((node: HTMLImageElement) => node.naturalWidth))
			.toBeGreaterThan(0);
		const box = (await frame.boundingBox())!;
		const nativeBox = (await destination.boundingBox())!;
		expect(box.height).toBeGreaterThanOrEqual(48);
		expect(nativeBox.height).toBeGreaterThanOrEqual(44);
		expect(nativeBox.x).toBeCloseTo(box.x + 1, 1);
		expect(nativeBox.x + nativeBox.width).toBeCloseTo(box.x + box.width - 1, 1);
		const point = { x: nativeBox.x + 2, y: nativeBox.y + nativeBox.height / 2 };
		expect(
			await destination.evaluate(
				(node, point) => document.elementFromPoint(point.x, point.y) === node,
				point
			)
		).toBe(true);
		await page.mouse.move(point.x, point.y);
		await expectBackground(frame, hoverBackground);
		await page.keyboard.press('Shift+Tab');
		await expect(destination).toBeFocused();
		await expectBackground(frame, focusBackground);
		await expectInsetFocus(
			frame,
			colorScheme === 'light' ? 'rgb(19, 87, 155)' : 'rgb(226, 196, 166)'
		);
		await expect(destination).toHaveCSS('outline-style', 'none');
		await expect(destination).toHaveJSProperty('tagName', 'INPUT');
		await expect(destination).toHaveAttribute('type', 'url');
		await expect(destination).toBeEnabled();
		await expect(destination).toHaveJSProperty('readOnly', true);
		await page.keyboard.press('ControlOrMeta+A');
		expect(
			await destination.evaluate((node: HTMLInputElement) => [
				node.selectionStart,
				node.selectionEnd
			])
		).toEqual([0, destinationURL.length]);
		await page.keyboard.type('unchanged');
		await expect(destination).toHaveValue(destinationURL);
		expect(await frame.boundingBox()).toEqual(box);
		expect(await destination.boundingBox()).toEqual(nativeBox);
		await expectSharedControls(page);
		await page.keyboard.press('Escape');
		await page.getByRole('link', { name: 'Controls notebook', exact: true }).click();
		await expect(
			page.getByRole('link', { name: 'Open Controls notebook (opens in a new tab)', exact: true })
		).toBeFocused();
		const bare = page.getByRole('textbox', { name: 'Destination', exact: true });
		await expect(bare.locator('..').locator('.ui-input__leading, img')).toHaveCount(0);
		await expect(bare).toHaveCSS('padding-inline-start', '12px');
		await expect(bare).toHaveValue('https://controls.example.test/notebook');
	}
});

test('literal chips share focused/pressed states and close into Search; no-JS chips stay informational', async ({
	page,
	browser
}) => {
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme });
		for (const filter of [
			{ name: 'Filter by access: login', query: 'access:login', hover: 'var(--color-primary)' },
			{
				name: `Filter by tag: ${literalTag}`,
				query: `tag:${literalTag}`,
				hover: 'var(--color-text)'
			}
		]) {
			await page.goto(`${server.url}/?link=archive`);
			await expect(openAction(page)).toBeFocused();
			await page
				.getByRole('dialog')
				.evaluate((node) =>
					Promise.all(node.getAnimations().map((animation) => animation.finished))
				);
			const chip = page.getByRole('button', { name: filter.name, exact: true });
			const box = await chip.boundingBox();
			await chip.hover();
			await expectBackground(
				chip,
				`color-mix(in srgb, ${filter.hover} 22%, var(--color-surface-card))`
			);
			await page.mouse.down();
			try {
				await expectBackground(chip, pressedBackground);
			} finally {
				await page.mouse.move(0, 0);
				await page.mouse.up();
			}
			await expect(chip).toBeFocused();
			await expectBackground(chip, focusBackground);
			await expectInsetFocus(
				chip,
				colorScheme === 'light' ? 'rgb(19, 87, 155)' : 'rgb(226, 196, 166)'
			);
			expect(await chip.boundingBox()).toEqual(box);
			await chip.press('Enter');
			await expect(page.getByRole('dialog')).toHaveCount(0);
			await expect(search(page)).toBeFocused();
			await expect(search(page)).toHaveValue(filter.query);
			await expect(page).toHaveURL(`${server.url}/?${new URLSearchParams({ q: filter.query })}`);
			await expect(
				page.getByRole('list', { name: 'Search results' }).getByRole('link')
			).toHaveCount(1);
		}
		const context = await browser.newContext({ javaScriptEnabled: false, colorScheme });
		try {
			const plain = await context.newPage();
			await plain.goto(`${server.url}/?link=archive`);
			await expectSharedControls(plain);
			const tags = plain.getByRole('list', { name: 'Tags', exact: true });
			await expect(tags.getByRole('button')).toHaveCount(0);
			await expect(tags.locator('span.ui-chip')).toHaveText(['login', literalTag]);
			for (const chip of await tags.locator('span.ui-chip').all()) {
				const background = await chip.evaluate((node) => getComputedStyle(node).backgroundColor);
				await chip.hover();
				await expect(chip).toHaveCSS('background-color', background);
				await expect(chip).toHaveCSS('cursor', 'auto');
				await expect(chip).toHaveJSProperty('tabIndex', -1);
			}
		} finally {
			await context.close();
		}
	}
});

test('pre-hydration and no-JS disabled controls never acquire interactive surfaces', async ({
	page,
	browser
}) => {
	const release = Promise.withResolvers<void>();
	await page.route(`**${directoryScript}`, async (route) => {
		await release.promise;
		await route.continue();
	});
	try {
		await page.goto(server.url, { waitUntil: 'domcontentloaded' });
		const theme = page.getByRole('button', { name: 'Switch to dark theme', exact: true });
		await expect(theme).toBeDisabled();
		await expect(search(page)).toBeDisabled();
		for (const control of [theme, search(page).locator('..')]) {
			const background = await control.evaluate((node) => getComputedStyle(node).backgroundColor);
			await control.hover();
			await expect(control).toHaveCSS('background-color', background);
			await expect(control).toHaveCSS('opacity', '0.5');
			await expect(control).toHaveCSS('cursor', 'default');
			await expect(control).toHaveCSS('outline-style', 'none');
			await expect(control).toHaveCSS('box-shadow', 'none');
		}
		await page.keyboard.press('Tab');
		await expect(page.getByRole('link', { name: 'Controls archive', exact: true })).toBeFocused();
		release.resolve();
		await expect(search(page)).toBeEnabled();
	} finally {
		release.resolve();
		await page.unrouteAll({ behavior: 'wait' });
	}
	for (const colorScheme of ['light', 'dark'] as const) {
		const context = await browser.newContext({ javaScriptEnabled: false, colorScheme });
		try {
			const plain = await context.newPage();
			await plain.goto(server.url);
			await expect(search(plain)).toBeDisabled();
			await expectSharedControls(plain);
			const frame = search(plain).locator('..');
			const background = await frame.evaluate((node) => getComputedStyle(node).backgroundColor);
			await frame.hover();
			await expect(frame).toHaveCSS('background-color', background);
			await expect(frame).toHaveCSS('outline-style', 'none');
			await plain.keyboard.press('Tab');
			await expect(
				plain.getByRole('link', { name: 'Controls archive', exact: true })
			).toBeFocused();
		} finally {
			await context.close();
		}
	}
});

test('credentials and SSO keep native forms, autofocus bindings, primary contrast and sign-out', async ({
	page
}) => {
	for (const strategy of ['credentials', 'sso'] as const) {
		const issuer = strategy === 'sso' ? await startIssuer() : undefined;
		let auth = credentialsAuth;
		if (issuer) auth = oidcAuth(issuer.origin);
		let authenticated: TestServer | undefined;
		try {
			authenticated = await startServer({ configuration: configuration + auth, publicDir });
			await authenticated.ready();
			issuer?.allowCallback(authenticated.url);
			for (const colorScheme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme });
				await page.goto(`${authenticated.url}/signin?callbackUrl=%2F%3Flink%3Darchive`);
				await expectSharedControls(page);
				await expect(page.locator('form')).toHaveAttribute('method', 'POST');
				await expect(page.locator('input[type="hidden"][name="redirectTo"]')).toHaveValue(
					'/?link=archive'
				);
				const submit = page.getByRole('button', { name: /^Sign in/ });
				await expect(submit).toHaveAttribute('type', 'submit');
				await expect(submit).toHaveCSS('column-gap', '12px');
				await expect(submit.locator('.icon')).toHaveCount(1);
				if (strategy === 'credentials') {
					const user = page.getByRole('textbox', { name: 'Username', exact: true });
					const pass = page.getByLabel('Password', { exact: true });
					await expect(user).toBeFocused();
					await expect(user).toHaveAttribute('id', 'username');
					await expect(user).toHaveAttribute('name', 'username');
					await expect(user).toHaveAttribute('autocomplete', 'username');
					await expect(user).toHaveAttribute('required', '');
					await expect(pass).toHaveAttribute('type', 'password');
					await expect(pass).toHaveAttribute('name', 'password');
					await expect(pass).toHaveAttribute('autocomplete', 'current-password');
					await expect(pass).toHaveAttribute('required', '');
					await user.fill(username);
					await page.keyboard.press('Tab');
					await expect(pass).toBeFocused();
					await pass.fill(password);
					await page.keyboard.press('Tab');
				}
				await expectPrimaryStates(page, submit);
				const posted = page.waitForRequest(
					(request) => request.method() === 'POST' && new URL(request.url()).pathname === '/signin'
				);
				await submit.press('Enter');
				const fields = new URLSearchParams((await posted).postData()!);
				expect(fields.get('redirectTo')).toBe('/?link=archive');
				if (strategy === 'credentials') {
					expect(fields.get('username')).toBe(username);
					expect(fields.get('password')).toBe(password);
				}
				await expect(page).toHaveURL(`${authenticated.url}/?link=archive`);
				await expect(openAction(page)).toBeFocused();
				await page.keyboard.press('Escape');
				await expect(page.getByRole('dialog')).toHaveCount(0);
				await expectSharedControls(page);
				const signout = page.getByRole('button', { name: 'Sign out', exact: true });
				await expect(signout).toHaveAttribute('type', 'submit');
				await signout.click();
				await expect(page).toHaveURL(`${authenticated.url}/signin?callbackUrl=%2F`);
			}
			if (issuer) {
				expect(issuer.violations).toEqual([]);
				expect(issuer.handlerErrors).toEqual([]);
			}
		} finally {
			try {
				if (authenticated) expect(await authenticated.stop()).toEqual({ code: 0, signal: null });
			} finally {
				if (issuer) await issuer.stop();
			}
		}
	}
});
