import { expect, test, type Page } from '@playwright/test';
import { dialogScript } from './support/details.js';
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
const grid = (page: Page) => page.getByRole('grid', { name: 'Search results', exact: true });

async function openResults(page: Page, width: number) {
	await page.setViewportSize({ width, height: 900 });
	await page.goto(server.url);
	await expect(input(page)).toBeEnabled();
	await expect(page.getByRole('grid')).toHaveCount(0);
	await expect(page.getByRole('listitem')).toHaveCount(13);
	await input(page).fill('navigationfixture');
	await expect(grid(page).getByRole('link')).toHaveCount(13);
	await expect(page.getByRole('status')).toHaveText('13 bookmarks found.');
}

async function columnCount(page: Page) {
	return grid(page)
		.getByRole('gridcell')
		.evaluateAll((cells) => {
			const firstTop = cells[0]!.getBoundingClientRect().top;
			return cells.filter((cell) => Math.abs(cell.getBoundingClientRect().top - firstTop) < 1)
				.length;
		});
}

async function expectSemanticRows(page: Page, columns: number) {
	const rows = grid(page).getByRole('row');
	const rowCount = Math.ceil(13 / columns);
	await expect(rows).toHaveCount(rowCount);
	for (let index = 0; index < rowCount; index++) {
		await expect(rows.nth(index).getByRole('gridcell')).toHaveCount(
			Math.min(columns, 13 - index * columns)
		);
	}
	const positions = await rows.evaluateAll((elements) =>
		elements.map((row) =>
			Array.from(row.children, (cell) => {
				const { top, left } = cell.getBoundingClientRect();
				return { top, left };
			})
		)
	);
	for (const [rowIndex, row] of positions.entries()) {
		if (rowIndex > 0) expect(row[0]!.top).toBeGreaterThan(positions[rowIndex - 1]![0]!.top);
		for (const [columnIndex, cell] of row.entries()) {
			expect(cell.top).toBeCloseTo(row[0]!.top, 0);
			expect(cell.left).toBeCloseTo(positions[0]![columnIndex]!.left, 0);
		}
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
	test(`filtered layout grid has real links, visual arrows, boundaries and one Tab stop at ${width}px`, async ({
		page
	}) => {
		await openResults(page, width);
		const results = grid(page);
		const links = results.getByRole('link');
		const expectedColumns = width === 360 ? 3 : 9;
		await expectSemanticRows(page, expectedColumns);
		await expect(results.getByRole('gridcell')).toHaveCount(13);
		await expect(page.getByRole('combobox')).toHaveCount(0);
		await expect(page.getByRole('listbox')).toHaveCount(0);
		await expect(results).toHaveAccessibleDescription(
			'Use arrow keys to move, Enter for details, Escape to return to Search.'
		);
		const columns = await columnCount(page);
		expect(columns).toBe(expectedColumns);
		await expect(results.locator('a[tabindex="0"]')).toHaveCount(1);
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
		await expect(results.locator('a[tabindex="0"]')).toHaveCount(1);
		await expect(links.nth(1)).toHaveAttribute('tabindex', '0');
		await page.keyboard.press('Shift+Tab');
		await expect(
			page.getByRole('button', { name: 'Switch to dark theme', exact: true })
		).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(links.nth(1)).toBeFocused();
		await page.keyboard.press('Tab');
		expect(await results.evaluate((node) => node.contains(document.activeElement))).toBe(false);
		await page.keyboard.press('Shift+Tab');
		await expect(links.nth(1)).toBeFocused();
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
		await expect(page.getByRole('listitem')).toHaveCount(13);
	});
}

test('resizing aligns semantic rows and arrows, preserving stable links and restoring relocated focus', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await openResults(page, 1280);
	await expectSemanticRows(page, 9);
	const links = grid(page).getByRole('link');
	const firstLink = await links.first().elementHandle();
	await input(page).press('Enter');
	await expect(links.first()).toBeFocused();
	await page.setViewportSize({ width: 360, height: 900 });
	await expectSemanticRows(page, 3);
	await expect.poll(() => columnCount(page)).toBe(3);
	await expect(links.first()).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(links.nth(3)).toBeFocused();
	const relocatedLink = await links.nth(3).elementHandle();
	await page.setViewportSize({ width: 1280, height: 900 });
	await expectSemanticRows(page, 9);
	await expect.poll(() => columnCount(page)).toBe(9);
	await expect(links.nth(3)).toBeFocused();
	expect(await relocatedLink!.evaluate((node) => node.isConnected)).toBe(false);
	await page.keyboard.press('ArrowDown');
	await expect(links.nth(12)).toBeFocused();
	expect(await links.first().evaluate((node, original) => node === original, firstLink)).toBe(true);
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
	expect(errors).toEqual([]);
});

test('unchanged row membership retains result and image nodes across query updates', async ({
	page
}) => {
	await openResults(page, 1280);
	await expectSemanticRows(page, 9);
	const tile = grid(page).getByRole('link').nth(5);
	const originalTile = await tile.elementHandle();
	const originalImage = await tile.locator('img').elementHandle();
	await input(page).fill('navigationfixture ');
	await expectSemanticRows(page, 9);
	await expect(input(page)).toBeFocused();
	expect(await tile.evaluate((node, original) => node === original, originalTile)).toBe(true);
	expect(
		await tile.locator('img').evaluate((node, original) => node === original, originalImage)
	).toBe(true);
	await page.setViewportSize({ width: 1200, height: 900 });
	await expectSemanticRows(page, 9);
	expect(await tile.evaluate((node, original) => node === original, originalTile)).toBe(true);
	await expect(input(page)).toBeFocused();
});

test('resizing with details open preserves dialog focus, query, URL and return result', async ({
	page
}) => {
	await openResults(page, 1280);
	await expectSemanticRows(page, 9);
	const tile = grid(page).getByRole('link').nth(5);
	const href = await tile.getAttribute('href');
	const originalTile = await tile.elementHandle();
	await tile.click();
	const close = page.getByRole('button', { name: 'Close', exact: true });
	await expect(close).toBeFocused();
	await page.setViewportSize({ width: 360, height: 900 });
	await expect(page.locator('[role="grid"] [role="row"]')).toHaveCount(5);
	await expect(close).toBeFocused();
	await expect(page).toHaveURL(server.url + href);
	await expect(input(page)).toHaveValue('navigationfixture');
	expect(await originalTile!.evaluate((node) => node.isConnected)).toBe(false);
	await page.keyboard.press('Escape');
	await expectSemanticRows(page, 3);
	await expect(tile).toBeFocused();
	await expect(page).toHaveURL(`${server.url}/`);
	await expect(input(page)).toHaveValue('navigationfixture');
	await page.goForward();
	await expect(close).toBeFocused();
	await page.goBack();
	await expect(tile).toBeFocused();
});

test('filtered links preserve modifier/middle new tabs and native Enter details', async ({
	page,
	context
}) => {
	await openResults(page, 360);
	const tile = grid(page).getByRole('link').first();
	const href = await tile.getAttribute('href');
	await expect(tile).toHaveAttribute('data-sveltekit-preload-data', 'off');
	const chunks: string[] = [];
	page.on('request', (request) => {
		if (request.url().endsWith(dialogScript)) chunks.push(request.url());
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
		await expect(page).toHaveURL(`${server.url}/`);
		await expect(page.getByRole('dialog')).toHaveCount(0);
	}
	expect(chunks).toEqual([]);
	await tile.focus();
	await tile.press('Enter');
	await expect(page).toHaveURL(server.url + href);
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
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
