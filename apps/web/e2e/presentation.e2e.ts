import { expect, test, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialsAuth, password, username } from './support/configuration.js';
import { startServer, type TestServer } from './support/server.js';

const labels = [
	'Household calendar and reminders',
	'UnbrokenBookmarkTitleThatMustWrapWithinItsCompactTile',
	'Library shelves',
	'Weather station',
	'Kitchen recipes',
	'Workshop guides',
	'Garden journal',
	'Energy monitor',
	'Neighborhood map'
];
const group = 'Everyday tools and household resources';
const hint = 'No bookmarks yet. Add links to the directory configuration to get started.';

function configuration(grouped = true) {
	return `site:
  title: Presentation fixture with a wrapping household heading
  description: Independent browser review data.
  footer: Contact the household maintainer.
  logo_path: /public/header.svg
appearance:
  primary_light_color: '#936'
  primary_dark_color: '#abcdef'
links:
${labels
	.map(
		(title, index) => `  entry-${index}:
    title: ${title}
    url: https://service.example.test/${index}?from=directory
${index < 4 ? '    logo_path: /public/bookmark.svg\n' : ''}${grouped && index < 8 ? `    group: ${index < 6 ? group : 'House projects'}\n` : ''}`
	)
	.join('')}`;
}

for (const javaScriptEnabled of [true, false]) {
	for (const colorScheme of ['light', 'dark'] as const) {
		test(`compact layout and native details: ${colorScheme}, JS ${javaScriptEnabled}`, async ({
			browser
		}) => {
			const publicDir = await mkdtemp(join(tmpdir(), 'directory-presentation-'));
			let context: BrowserContext | undefined;
			let server: TestServer | undefined;
			try {
				context = await browser.newContext({
					javaScriptEnabled,
					colorScheme,
					reducedMotion: 'no-preference'
				});
				const svg =
					'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#369" d="M0 0h64v64H0z"/></svg>';
				for (const name of ['header', 'bookmark']) {
					await writeFile(join(publicDir, `${name}.svg`), svg);
				}
				server = await startServer({
					configuration: configuration(),
					publicDir,
					secret: null,
					origin: null
				});
				await server.ready();
				const page = await context.newPage();
				const accent = colorScheme === 'light' ? 'rgb(153, 51, 102)' : 'rgb(171, 205, 239)';
				for (const width of [360, 768, 1280]) {
					await page.setViewportSize({ width, height: 900 });
					await page.goto(server.url);
					await expect(page.locator('.groups h2')).toHaveText([group, 'House projects', 'Other']);
					await expect(page.locator('.groups h2').first()).toHaveCSS('text-transform', 'uppercase');
					await expect(page.locator('header img[src="/public/header.svg"]')).toHaveCSS(
						'width',
						'48px'
					);
					const tiles = page.locator('a[href^="/?link="]');
					await expect(tiles).toHaveCount(9);
					for (const [index, tile] of (await tiles.all()).entries()) {
						await tile.scrollIntoViewIfNeeded();
						await expect(tile).toHaveAttribute('data-sveltekit-preload-data', 'off');
						const image = tile.locator('img[width="64"]');
						await expect(image).toHaveAttribute(
							'src',
							index < 4 ? '/public/bookmark.svg' : `/bookmarks/entry-${index}/logo`
						);
						await expect
							.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
							.toBeGreaterThan(0);
						const geometry = await tile.evaluate((node) => {
							const box = node.getBoundingClientRect();
							const style = getComputedStyle(node);
							const image = node.querySelector('img')!.getBoundingClientRect();
							const title = node.querySelector('span')!.getBoundingClientRect();
							return {
								width: box.width,
								contentWidth:
									box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
								rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
								imageOffset: image.x + image.width / 2 - (box.x + box.width / 2),
								titleOffset: title.x + title.width / 2 - (box.x + box.width / 2)
							};
						});
						expect(geometry.contentWidth).toBeCloseTo((width < 768 ? 6 : 7) * geometry.rem, 1);
						expect(geometry.width).toBeCloseTo((width < 768 ? 7 : 9) * geometry.rem, 1);
						expect(Math.abs(geometry.imageOffset)).toBeLessThan(1);
						expect(Math.abs(geometry.titleOffset)).toBeLessThan(1);
					}
					const longTitle = tiles.nth(1).locator('span');
					expect(
						await longTitle.evaluate(
							(node) =>
								node.getBoundingClientRect().height > parseFloat(getComputedStyle(node).lineHeight)
						)
					).toBe(true);
					const first = tiles.first();
					const motionSurface = first.locator('.tile-icon');
					await first.hover();
					await expect(first).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
					await expect(first).toHaveCSS('border-width', '0px');
					await expect(first).toHaveCSS('text-decoration-line', 'none');
					await expect(first.locator('.tile-title')).toHaveCSS('text-decoration-line', 'underline');
					await expect(first.locator('img')).toHaveCSS('filter', 'none');
					await expect(first.locator('img')).toHaveCSS('transform', 'none');
					await expect(motionSurface).toHaveCSS(
						'filter',
						colorScheme === 'light'
							? 'drop-shadow(rgba(0, 0, 0, 0.24) 0px 6px 10px)'
							: 'drop-shadow(rgba(255, 255, 255, 0.45) 0px 6px 10px)'
					);
					await expect(motionSurface).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -2)');
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
					).toBe(true);
					await page.keyboard.press('Tab');
					if (javaScriptEnabled) {
						const search = page.getByRole('searchbox', { name: 'Search', exact: true });
						await expect(search).toBeFocused();
						await expect(search.locator('..')).toHaveCSS('outline-color', accent);
						await expect(search).toHaveCSS('outline-style', 'none');
						await page.keyboard.press('Tab');
						const toggle = page.getByRole('button', { name: 'Switch to dark theme', exact: true });
						await expect(toggle).toBeFocused();
						await expect(toggle).toHaveCSS('outline-color', accent);
						await page.keyboard.press('Tab');
					}
					await expect(first).toBeFocused();
					await expect(first).toHaveCSS('outline-color', accent);
					await first.click();
					await expect(page).toHaveURL(`${server.url}/?link=entry-0`);
					const external = page.getByRole('link', {
						name: `Open ${labels[0]} (opens in a new tab)`,
						exact: true
					});
					const destination = page.getByRole('textbox', { name: 'Destination', exact: true });
					const heading = page.getByRole('heading', { name: labels[0]!, exact: true, level: 2 });
					await expect(heading).toHaveCount(1);
					await expect(heading).toHaveJSProperty('tagName', 'H2');
					await expect(heading).toHaveText(labels[0]!);
					let dismiss = page.getByRole('link', { name: 'Back to directory', exact: true });
					if (javaScriptEnabled) {
						const dialog = page.getByRole('dialog');
						await expect(dialog).toBeVisible();
						await expect(dialog.getByRole('heading', { level: 2 })).toHaveCount(1);
						await expect(heading).toHaveAttribute('role', 'heading');
						await expect(heading).toHaveAttribute('aria-level', '2');
						await expect(heading).toHaveAttribute('id', /.+/);
						await expect(dialog).toHaveAttribute(
							'aria-labelledby',
							(await heading.getAttribute('id'))!
						);
						await expect(dialog).toHaveAccessibleName(labels[0]!);
						dismiss = page.getByRole('button', { name: 'Close', exact: true });
						await expect(external).toBeFocused();
					} else {
						await expect(heading).toHaveAttribute('id', 'link-details-title');
						await expect(page.locator('section.details')).toHaveAttribute(
							'aria-labelledby',
							'link-details-title'
						);
						await expect(dismiss).toHaveAttribute('href', '/');
						await expect(dismiss).toHaveAttribute('data-sveltekit-preload-data', 'off');
						await expect(dismiss).toHaveCSS('text-decoration-color', accent);
					}
					await expect(external).toHaveAttribute(
						'href',
						'https://service.example.test/0?from=directory'
					);
					await expect(external).toHaveAttribute('target', '_blank');
					await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
					await expect(external).toHaveText('Open');
					await expect(external.locator('img, svg')).toHaveCount(0);
					await expect(destination).toHaveValue('https://service.example.test/0?from=directory');
					if (javaScriptEnabled) {
						await page.keyboard.press('Shift+Tab');
						await expect(destination).toBeFocused();
						await page.keyboard.press('Shift+Tab');
						await expect(dismiss).toBeFocused();
					}
					const controls = javaScriptEnabled
						? [destination, external, dismiss]
						: [dismiss, destination, external];
					for (const control of controls) {
						await page.keyboard.press('Tab');
						await expect(control).toBeFocused();
						let focusSurface = control;
						if (control === destination) {
							focusSurface = page.locator('.destination-value');
							await expect(destination).toHaveCSS('outline-style', 'none');
							await expect(focusSurface).toHaveCSS('outline-offset', '-2px');
						}
						let focusColor = accent;
						if (control === external) {
							focusColor = await external.evaluate((node) => getComputedStyle(node).color);
						}
						await expect(focusSurface).toHaveCSS('outline-style', 'solid');
						await expect(focusSurface).toHaveCSS('outline-color', focusColor);
					}
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
					).toBe(true);
					await dismiss.click();
					await expect(page).toHaveURL(`${server.url}/`);
				}
			} finally {
				const [contextClosed, serverStopped] = await Promise.allSettled([
					context?.close(),
					server?.stop()
				]);
				await rm(publicDir, { recursive: true, force: true });
				expect(contextClosed).toEqual({ status: 'fulfilled', value: undefined });
				expect(serverStopped).toEqual({
					status: 'fulfilled',
					value: server ? { code: 0, signal: null } : undefined
				});
			}
		});
	}
}

test('public configured accents preserve the body palette and private directory boundary', async ({
	page
}) => {
	const light = '#13579b';
	const dark = '#e2c4a6';
	const server = await startServer({
		configuration: configuration().replace('#936', light).replace('#abcdef', dark) + credentialsAuth
	});
	try {
		await server.ready();
		for (const path of ['/signin', '/signin/__data.json', '/__data.json']) {
			const response = await server.fetch(path);
			expect(response.status).toBe(path === '/__data.json' ? 401 : 200);
			const text = await response.text();
			for (const value of [username, password, '/public/header.svg', '/public/bookmark.svg'])
				expect(text).not.toContain(value);
			if (path === '/signin') {
				expect(text).toContain(`--color-primary:light-dark(${light},${dark})`);
			} else {
				expect(text).not.toContain('--color-primary');
			}
		}
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			await page.goto(`${server.url}/signin`);
			await expect(page.locator('body')).toHaveCSS(
				'background-color',
				colorScheme === 'light' ? 'rgb(245, 245, 245)' : 'rgb(16, 19, 20)'
			);
			await expect(page.getByLabel('Username')).toBeFocused();
			await page.keyboard.press('Tab');
			const input = page.getByLabel('Password');
			await expect(input).toBeFocused();
			await expect(input).toHaveCSS('outline-style', 'none');
			await expect(input.locator('..')).toHaveCSS('outline-style', 'solid');
			await expect(input.locator('..')).toHaveCSS(
				'outline-color',
				colorScheme === 'light' ? 'rgb(19, 87, 155)' : 'rgb(226, 196, 166)'
			);
		}
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
		const response = await page.request.get(`${server.url}/__data.json`);
		expect(response.status()).toBe(200);
		const payload = await response.text();
		for (const value of [light, dark]) expect(payload).toContain(value);
		for (const value of [username, password, server.secret!, server.path])
			expect(payload).not.toContain(value);

		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			const document = await page.goto(`${server.url}/?link=entry-0`);
			const html = await document!.text();
			expect(html).toContain(`--color-primary:light-dark(${light},${dark})`);
			const accent = colorScheme === 'light' ? 'rgb(19, 87, 155)' : 'rgb(226, 196, 166)';
			const dialog = page.getByRole('dialog');
			await expect(dialog).toBeVisible();
			const heading = dialog.getByRole('heading', { level: 2 });
			await expect(heading).toHaveCount(1);
			await expect(heading).toHaveJSProperty('tagName', 'H2');
			await expect(heading).toHaveText(labels[0]!);
			await expect(heading).toHaveAttribute('role', 'heading');
			await expect(heading).toHaveAttribute('aria-level', '2');
			await expect(heading).toHaveAttribute('id', /.+/);
			await expect(dialog).toHaveAttribute('aria-labelledby', (await heading.getAttribute('id'))!);
			await expect(dialog).toHaveAccessibleName(labels[0]!);
			const close = page.getByRole('button', { name: 'Close', exact: true });
			const external = page.getByRole('link', {
				name: `Open ${labels[0]} (opens in a new tab)`,
				exact: true
			});
			const destination = page.getByRole('textbox', { name: 'Destination', exact: true });
			await expect(external).toBeFocused();
			for (const control of [close, destination, external]) {
				await control.focus();
				await expect(control).toBeFocused();
				let focusSurface = control;
				if (control === destination) {
					focusSurface = page.locator('.destination-value');
					await expect(destination).toHaveCSS('outline-style', 'none');
					await expect(focusSurface).toHaveCSS('outline-offset', '-2px');
				}
				let focusColor = accent;
				if (control === external) {
					focusColor = await external.evaluate((node) => getComputedStyle(node).color);
				}
				await expect(focusSurface).toHaveCSS('outline-style', 'solid');
				await expect(focusSurface).toHaveCSS('outline-color', focusColor);
			}
			await close.click();
			await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
			for (const control of [
				page.getByRole('searchbox', { name: 'Search', exact: true }),
				page.getByRole('button', { name: 'Switch to dark theme', exact: true }),
				page.getByRole('button', { name: 'Sign out' })
			]) {
				await page.keyboard.press('Tab');
				await expect(control).toBeFocused();
				let focusSurface = control;
				if (await control.evaluate((node) => node instanceof HTMLInputElement)) {
					focusSurface = control.locator('..');
					await expect(control).toHaveCSS('outline-style', 'none');
				}
				await expect(focusSurface).toHaveCSS('outline-style', 'solid');
				await expect(focusSurface).toHaveCSS('outline-color', accent);
			}
		}
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('flat tiles and actionable empty guidance remain visible', async ({ page }) => {
	const server = await startServer({
		configuration: configuration(false),
		secret: null,
		origin: null
	});
	try {
		await server.ready();
		await page.goto(server.url);
		await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
		await expect(page.locator('a[href^="/?link="] span')).toHaveText(labels);
		await server.replace('site:\n  title: Empty presentation fixture\nlinks: {}\n');
		await expect.poll(async () => (await server.fetch('/')).text()).toContain(hint);
		await page.goto(server.url);
		await expect(page.getByText(hint, { exact: true })).toBeVisible();
		await expect(page.locator('a[href^="/?link="]')).toHaveCount(0);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});
