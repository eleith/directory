import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialsAuth, password, username } from './support/configuration.js';
import { startServer } from './support/server.js';

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
${index < 4 ? '    logo_path: /public/bookmark.svg\n' : ''}    favicon_path: /public/service.svg
${grouped && index < 8 ? `    group: ${index < 6 ? group : 'House projects'}\n` : ''}`
	)
	.join('')}`;
}

for (const javaScriptEnabled of [true, false]) {
	for (const colorScheme of ['light', 'dark'] as const) {
		test(`compact layout and native details: ${colorScheme}, JS ${javaScriptEnabled}`, async ({
			browser
		}) => {
			const publicDir = await mkdtemp(join(tmpdir(), 'directory-presentation-'));
			const context = await browser.newContext({ javaScriptEnabled, colorScheme });
			const svg =
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#369" d="M0 0h64v64H0z"/></svg>';
			await Promise.all(
				['header', 'bookmark', 'service'].map((name) =>
					writeFile(join(publicDir, `${name}.svg`), svg)
				)
			);
			const server = await startServer({
				configuration: configuration(),
				publicDir,
				secret: null,
				origin: null
			});
			try {
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
							const image = node.querySelector('img')!.getBoundingClientRect();
							const title = node.querySelector('span')!.getBoundingClientRect();
							return {
								width: box.width,
								rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
								imageOffset: image.x + image.width / 2 - (box.x + box.width / 2),
								titleOffset: title.x + title.width / 2 - (box.x + box.width / 2)
							};
						});
						expect(geometry.width).toBeCloseTo(6 * geometry.rem, 1);
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
					await first.hover();
					await expect(first).toHaveCSS(
						'background-color',
						colorScheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(27, 32, 34)'
					);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
					).toBe(true);
					await page.keyboard.press('Tab');
					if (javaScriptEnabled) {
						const search = page.getByRole('searchbox', { name: 'Search', exact: true });
						await expect(search).toBeFocused();
						await expect(search).toHaveCSS('outline-color', accent);
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
					let dismiss = page.getByRole('link', { name: 'Back to directory', exact: true });
					if (javaScriptEnabled) {
						await expect(page.getByRole('dialog')).toBeVisible();
						dismiss = page.getByRole('button', { name: 'Close', exact: true });
						await expect(dismiss).toBeFocused();
					} else {
						await expect(dismiss).toHaveAttribute('href', '/');
						await expect(dismiss).toHaveAttribute('data-sveltekit-preload-data', 'off');
						await expect(dismiss).toHaveCSS('text-decoration-color', accent);
					}
					const external = page.getByRole('link', {
						name: 'Open service (opens in a new tab)',
						exact: true
					});
					await expect(external).toHaveAttribute(
						'href',
						'https://service.example.test/0?from=directory'
					);
					await expect(external).toHaveAttribute('target', '_blank');
					await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
					await expect(external.locator('img[src="/public/service.svg"]')).toHaveCSS(
						'width',
						'24px'
					);
					if (javaScriptEnabled) {
						await page.keyboard.press('Shift+Tab');
						await expect(external).toBeFocused();
					}
					for (const link of [dismiss, external]) {
						await page.keyboard.press('Tab');
						await expect(link).toBeFocused();
						await expect(link).toHaveCSS('outline-style', 'solid');
						await expect(link).toHaveCSS('outline-color', accent);
					}
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
					).toBe(true);
					await dismiss.click();
					await expect(page).toHaveURL(`${server.url}/`);
				}
			} finally {
				await context.close();
				expect(await server.stop()).toEqual({ code: 0, signal: null });
				await rm(publicDir, { recursive: true, force: true });
			}
		});
	}
}

test('configured theme inputs stay private and leave sign-in on the default palette', async ({
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
			for (const value of [light, dark, username, password]) expect(text).not.toContain(value);
		}
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			await page.goto(`${server.url}/signin`);
			await expect(page.locator('.directory-theme')).toHaveCount(0);
			await expect(page.locator('body')).toHaveCSS(
				'background-color',
				colorScheme === 'light' ? 'rgb(245, 245, 245)' : 'rgb(16, 19, 20)'
			);
			await page.keyboard.press('Tab');
			const input = page.getByLabel('Username');
			await expect(input).toBeFocused();
			await expect(input).toHaveCSS('outline-style', 'solid');
			await expect(input).toHaveCSS(
				'outline-color',
				colorScheme === 'light' ? 'rgb(23, 23, 23)' : 'rgb(245, 245, 245)'
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
			for (const value of [light, dark]) expect(html).toContain(value);
			const boundary = page.locator('.directory-theme');
			await expect(boundary).toHaveCSS('--directory-primary-light', light);
			await expect(boundary).toHaveCSS('--directory-primary-dark', dark);
			const accent = colorScheme === 'light' ? 'rgb(19, 87, 155)' : 'rgb(226, 196, 166)';
			await expect(page.getByRole('dialog')).toBeVisible();
			const close = page.getByRole('button', { name: 'Close', exact: true });
			await expect(close).toBeFocused();
			for (const control of [
				close,
				page.getByRole('link', { name: 'Open service (opens in a new tab)', exact: true })
			]) {
				await control.focus();
				await expect(control).toBeFocused();
				await expect(control).toHaveCSS('outline-style', 'solid');
				await expect(control).toHaveCSS('outline-color', accent);
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
				await expect(control).toHaveCSS('outline-style', 'solid');
				await expect(control).toHaveCSS('outline-color', accent);
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
