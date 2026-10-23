import { expect, test, type Page } from '@playwright/test';
import { startServer, type TestServer } from './support/server.js';

const configuration = `site:
  title: Household services and shared tools
  description: A configured description remains visible beside the full-size logo.
  footer: Contact your household maintainer.
links:
${Array.from(
	{ length: 13 },
	(_, index) => `  service-${index}:
    title: ${index === 4 ? 'AnUnbrokenTitleThatStillWrapsWithoutOverflow' : `Service ${index}`}
    url: https://service-${index}.example.test/
    group: Household
    tags: navigationfixture`
).join('\n')}
`;
let server: TestServer;

test.beforeAll(async () => {
	server = await startServer({ configuration, secret: null, origin: null });
	await server.ready();
});
test.afterAll(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
});

const input = (page: Page) => page.getByRole('searchbox', { name: 'Search', exact: true });
const resultList = (page: Page) => page.getByRole('list', { name: 'Search results', exact: true });

async function openResults(page: Page, width: number) {
	await page.setViewportSize({ width, height: 900 });
	await page.goto(server.url);
	await expect(input(page)).toBeEnabled();
	await expect(page.getByRole('grid')).toHaveCount(0);
	await expect(page.getByRole('listitem')).toHaveCount(13);
	await input(page).fill('navigationfixture');
	await expect(resultList(page).getByRole('link')).toHaveCount(13);
	await expect(page.getByRole('grid')).toHaveCount(0);
	await expect(page.getByRole('status')).toHaveText('13 bookmarks found.');
}

async function columnCount(page: Page) {
	return resultList(page)
		.getByRole('link')
		.evaluateAll((links) => {
			const firstTop = links[0]!.getBoundingClientRect().top;
			return links.filter((link) => Math.abs(link.getBoundingClientRect().top - firstTop) < 1)
				.length;
		});
}

async function expectResultLayout(page: Page, columns: number) {
	const results = resultList(page);
	await expect(results).toHaveCount(1);
	await expect(results.getByRole('listitem')).toHaveCount(13);
	await expect(results.getByRole('link')).toHaveCount(13);
	await expect
		.poll(() =>
			results.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
		)
		.toBe(columns);
	const positions = await results.getByRole('link').evaluateAll((links) =>
		links.map((link) => {
			const { top, left } = link.getBoundingClientRect();
			return { top, left };
		})
	);
	for (const [index, position] of positions.entries()) {
		expect(position.left).toBeCloseTo(positions[index % columns]!.left, 0);
		expect(position.top).toBeCloseTo(positions[Math.floor(index / columns) * columns]!.top, 0);
		if (index >= columns) expect(position.top).toBeGreaterThan(positions[index - columns]!.top);
	}
}

async function hasNativeSearchCancelSuppression(page: Page) {
	return input(page).evaluate((node) => {
		for (const sheet of document.styleSheets) {
			for (const rule of sheet.cssRules) {
				if (!(rule instanceof CSSStyleRule)) continue;
				const [selector, pseudo] = rule.selectorText.split('::');
				if (pseudo !== '-webkit-search-cancel-button' || !node.matches(selector!)) continue;
				if (rule.style.webkitAppearance === 'none') return true;
			}
		}
		return false;
	});
}

for (const width of [360, 1280]) {
	test(`filtered list has native Tab order, real links, visual arrows and boundaries at ${width}px`, async ({
		page
	}) => {
		await openResults(page, width);
		const results = resultList(page);
		const links = results.getByRole('link');
		const expectedColumns = width === 360 ? 3 : 8;
		await expectResultLayout(page, expectedColumns);
		await expect(page.getByRole('combobox')).toHaveCount(0);
		await expect(page.getByRole('listbox')).toHaveCount(0);
		await expect(results).toHaveAccessibleDescription(
			'Use Tab or arrow keys to move, Enter for details, Escape to return to Search.'
		);
		const columns = await columnCount(page);
		expect(columns).toBe(expectedColumns);
		await expect(results.locator('a[tabindex]')).toHaveCount(0);
		expect(await links.evaluateAll((nodes) => nodes.every((node) => node.tabIndex === 0))).toBe(
			true
		);
		await input(page).press('Enter');
		for (let index = 0; index < 13; index++) {
			await expect(links.nth(index)).toBeFocused();
			if (index < 12) await page.keyboard.press('Tab');
		}
		await page.keyboard.press('Tab');
		expect(await results.evaluate((node) => node.contains(document.activeElement))).toBe(false);
		await page.keyboard.press('Shift+Tab');
		await expect(links.last()).toBeFocused();
		for (let index = 12; index > 0; index--) {
			await page.keyboard.press('Shift+Tab');
			await expect(links.nth(index - 1)).toBeFocused();
		}
		await page.keyboard.press('Shift+Tab');
		await expect(
			page.getByRole('button', { name: 'Switch to dark theme', exact: true })
		).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(links.first()).toBeFocused();
		await input(page).focus();
		await input(page).press('ArrowDown');
		await expect(links.first()).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowUp');
		await expect(links.first()).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect(links.nth(1)).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(links.nth(columns + 1)).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(links.nth(1)).toBeFocused();
		await links.nth(columns - 1).focus();
		await page.keyboard.press('ArrowRight');
		await expect(links.nth(columns - 1)).toBeFocused();
		await page.keyboard.press('ArrowDown');
		const nextRowIndex = Math.min(columns * 2 - 1, 12);
		await expect(links.nth(nextRowIndex)).toBeFocused();
		await page.keyboard.press('Home');
		await expect(links.nth(columns)).toBeFocused();
		await page.keyboard.press('End');
		await expect(links.nth(nextRowIndex)).toBeFocused();
		await links.last().focus();
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowRight');
		await expect(links.last()).toBeFocused();
		await page.keyboard.press('Home');
		await expect(links.nth(Math.floor(12 / columns) * columns)).toBeFocused();
		await links.first().focus();
		await page.keyboard.press('ArrowRight');
		await expect(links.nth(1)).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(links.nth(2)).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(links.nth(1)).toBeFocused();
		await expect(results.locator('a[tabindex]')).toHaveCount(0);
		for (const options of [
			{ isComposing: true },
			{ ctrlKey: true },
			{ altKey: true },
			{ metaKey: true },
			{ shiftKey: true }
		]) {
			await links.nth(1).dispatchEvent('keydown', { key: 'ArrowRight', ...options });
			await links.nth(1).dispatchEvent('keydown', { key: 'Escape', ...options });
			await expect(links.nth(1)).toBeFocused();
		}
		await page.keyboard.press('Escape');
		await expect(input(page)).toBeFocused();
		await expect(input(page)).toHaveValue('navigationfixture');
		await expect(links).toHaveCount(13);
		await page.keyboard.press('Escape');
		await expect(input(page)).toHaveValue('');
		await expect(page.getByRole('grid')).toHaveCount(0);
		await expect(resultList(page)).toHaveCount(0);
		await expect(page.getByRole('listitem')).toHaveCount(13);
		await input(page).fill('zzzxxyyqqq');
		await expect(page.getByRole('status')).toHaveText('No bookmarks found.');
		await expect(resultList(page)).toHaveCount(0);
		await input(page).press('Enter');
		await input(page).press('ArrowDown');
		await expect(input(page)).toBeFocused();
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});
}

test('resizing aligns visual arrows while preserving link nodes and focus', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await openResults(page, 1280);
	await expectResultLayout(page, 8);
	const links = resultList(page).getByRole('link');
	const firstLink = await links.first().elementHandle();
	await input(page).press('Enter');
	await expect(links.first()).toBeFocused();
	await page.setViewportSize({ width: 360, height: 900 });
	await expectResultLayout(page, 3);
	await expect.poll(() => columnCount(page)).toBe(3);
	await expect(links.first()).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(links.nth(3)).toBeFocused();
	const focusedLink = await links.nth(3).elementHandle();
	const focusedImage = await links.nth(3).locator('img').elementHandle();
	await page.setViewportSize({ width: 1280, height: 900 });
	await expectResultLayout(page, 8);
	await expect.poll(() => columnCount(page)).toBe(8);
	await expect(links.nth(3)).toBeFocused();
	expect(await focusedLink!.evaluate((node) => node.isConnected)).toBe(true);
	expect(await links.nth(3).evaluate((node, original) => node === original, focusedLink)).toBe(
		true
	);
	expect(
		await links
			.nth(3)
			.locator('img')
			.evaluate((node, original) => node === original, focusedImage)
	).toBe(true);
	await page.keyboard.press('ArrowDown');
	await expect(links.nth(11)).toBeFocused();
	expect(await links.first().evaluate((node, original) => node === original, firstLink)).toBe(true);
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
	expect(errors).toEqual([]);
});

test('result and image nodes survive query updates and column-changing resizes', async ({
	page
}) => {
	await openResults(page, 1280);
	await expectResultLayout(page, 8);
	const tile = resultList(page).getByRole('link').nth(5);
	const originalTile = await tile.elementHandle();
	const originalImage = await tile.locator('img').elementHandle();
	await input(page).fill('navigationfixture ');
	await expectResultLayout(page, 8);
	await expect(input(page)).toBeFocused();
	expect(await tile.evaluate((node, original) => node === original, originalTile)).toBe(true);
	expect(
		await tile.locator('img').evaluate((node, original) => node === original, originalImage)
	).toBe(true);
	for (const width of [1200, 360, 1280]) {
		await page.setViewportSize({ width, height: 900 });
		await expectResultLayout(page, width === 360 ? 3 : 8);
		expect(await tile.evaluate((node, original) => node === original, originalTile)).toBe(true);
		expect(
			await tile.locator('img').evaluate((node, original) => node === original, originalImage)
		).toBe(true);
		await expect(input(page)).toBeFocused();
	}
});

test('resizing with details open preserves dialog focus, query, URL and return result', async ({
	page
}) => {
	await openResults(page, 1280);
	await expectResultLayout(page, 8);
	const tile = resultList(page).getByRole('link').nth(5);
	const href = await tile.getAttribute('href');
	expect(new URL(href!, server.url).searchParams.get('q')).toBe('navigationfixture');
	const originalTile = await tile.elementHandle();
	await tile.click();
	const external = page.getByRole('dialog').getByRole('link', { name: /^Open / });
	await expect(external).toBeFocused();
	await page.setViewportSize({ width: 360, height: 900 });
	const hiddenResults = page.locator('.groups ul.link-grid');
	await expect(hiddenResults.locator('li')).toHaveCount(13);
	await expect
		.poll(() =>
			hiddenResults.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
		)
		.toBe(3);
	await expect(external).toBeFocused();
	await expect(page).toHaveURL(server.url + href);
	await expect(input(page)).toHaveValue('navigationfixture');
	expect(await originalTile!.evaluate((node) => node.isConnected)).toBe(true);
	await page.keyboard.press('Escape');
	await expectResultLayout(page, 3);
	await expect(tile).toBeFocused();
	expect(await tile.evaluate((node, original) => node === original, originalTile)).toBe(true);
	await expect(page).toHaveURL(`${server.url}/?q=navigationfixture`);
	await expect(input(page)).toHaveValue('navigationfixture');
	await page.goForward();
	await expect(page).toHaveURL(server.url + href);
	await expect(external).toBeFocused();
	const close = page.getByRole('button', { name: 'Close', exact: true });
	const destination = page.getByRole('textbox', { name: 'Destination', exact: true });
	await expect(destination).toHaveJSProperty('readOnly', true);
	const tag = page.getByRole('button', {
		name: 'Filter by tag: navigationfixture',
		exact: true
	});
	for (const control of [close, tag, destination, external]) {
		await page.keyboard.press('Tab');
		await expect(control).toBeFocused();
	}
	await page.goBack();
	await expect(page).toHaveURL(`${server.url}/?q=navigationfixture`);
	await expect(tile).toBeFocused();
});

test('filtered links preserve modifier/middle new tabs and native Enter details', async ({
	page,
	context
}) => {
	await openResults(page, 360);
	const tile = resultList(page).getByRole('link').first();
	const href = await tile.getAttribute('href');
	expect(new URL(href!, server.url).searchParams.get('q')).toBe('navigationfixture');
	await expect(tile).toHaveAttribute('data-sveltekit-preload-data', 'off');
	const assets: string[] = [];
	page.on('request', (request) => {
		if (['script', 'stylesheet'].includes(request.resourceType())) assets.push(request.url());
	});
	for (const options of [
		{ modifiers: ['Control'] as ['Control'] },
		{ button: 'middle' as const }
	]) {
		const popup = context.waitForEvent('page');
		await tile.click(options);
		const opened = await popup;
		await expect(opened).toHaveURL(server.url + href);
		await opened.close();
		await expect(page).toHaveURL(`${server.url}/?q=navigationfixture`);
		await expect(page.getByRole('dialog')).toHaveCount(0);
	}
	expect(assets).toEqual([]);
	await tile.focus();
	await tile.press('Enter');
	await expect(page).toHaveURL(server.url + href);
	await expect(page.getByRole('dialog')).toBeVisible();
	expect(assets).toEqual([]);
	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(`${server.url}/?q=navigationfixture`);
	await expect(tile).toBeFocused();
	await expect(input(page)).toHaveValue('navigationfixture');
});

for (const colorScheme of ['light', 'dark'] as const) {
	for (const width of [360, 1280]) {
		test(`soft search and single inset clear retain accessible focus at ${width}px in ${colorScheme}`, async ({
			page
		}) => {
			await page.emulateMedia({ colorScheme });
			await openResults(page, width);
			const clear = page.getByRole('button', { name: 'Clear search', exact: true });
			await expect(clear).toHaveCount(1);
			await expect(clear).toHaveText('');
			for (const icon of [page.locator('.search .magnifier'), clear.locator('svg')]) {
				await expect(icon).toBeVisible();
				await expect(icon).toHaveAttribute('aria-hidden', 'true');
				await expect(icon).toHaveAttribute('focusable', 'false');
				await expect(icon).toHaveCSS('width', '20px');
				const color = await icon.evaluate((node) => getComputedStyle(node).color);
				await expect(icon.locator('path')).toHaveCSS('fill', color);
			}
			const inputBox = (await input(page).boundingBox())!;
			const clearBox = (await clear.boundingBox())!;
			expect(inputBox.height).toBeGreaterThanOrEqual(48);
			expect(clearBox.width).toBeGreaterThanOrEqual(44);
			expect(clearBox.height).toBeGreaterThanOrEqual(44);
			expect(clearBox.x).toBeGreaterThan(inputBox.x);
			expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width);
			await expect(input(page)).toHaveCSS('border-width', '0px');
			await expect(input(page)).toHaveCSS('border-radius', '12px');
			await expect(input(page)).toHaveCSS('outline-style', 'solid');
			expect(await hasNativeSearchCancelSuppression(page)).toBe(true);
			await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '24px');
			await expect(page.locator('.description')).toHaveText(
				'A configured description remains visible beside the full-size logo.'
			);
			await expect(page.locator('header img')).toHaveCSS('width', '48px');
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true
			);
			await clear.click();
			await expect(input(page)).toBeFocused();
			await expect(input(page)).toHaveValue('');
			await expect(clear).toHaveCount(0);
			await expect(page.getByRole('status')).toBeEmpty();
			await expect(page.getByRole('listitem')).toHaveCount(13);
		});
	}
}
