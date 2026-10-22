import { expect, test, type Locator } from '@playwright/test';
import { startServer, type TestServer } from './support/server.js';

const longTitle =
	'The shared household archive for photographs documents school projects recipes and reference materials with the trailing word marshmallow';
const unbrokenTitle =
	'HouseholdServicesAndReferenceShelvesWithAnExtremelyLongUnbrokenBookmarkTitle';
const groupLabel = 'A long informational group caption that remains fully readable below the title';
const configuration = `site:
  title: Tile title fixture
links:
  archive:
    title: ${longTitle}
    url: https://archive.example.test
    group: ${groupLabel}
  unbroken:
    title: ${unbrokenTitle}
    url: https://reference.example.test
    group: ${groupLabel}
  books:
    title: Books
    url: https://books.example.test
    group: ${groupLabel}
`;
let server: TestServer;

test.beforeAll(async () => {
	server = await startServer({ configuration, secret: null, origin: null });
	await server.ready();
});
test.afterAll(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
});

async function expectThreeLines(title: Locator) {
	const dimensions = await title.evaluate((node) => ({
		height: node.getBoundingClientRect().height,
		lineHeight: parseFloat(getComputedStyle(node).lineHeight),
		scrollHeight: node.scrollHeight
	}));
	expect(dimensions.height).toBeCloseTo(dimensions.lineHeight * 3, 0);
	expect(dimensions.scrollHeight).toBeGreaterThan(Math.ceil(dimensions.height));
}

test('long tile titles stop at three lines without reserving lines for short titles', async ({
	page
}) => {
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme });
		for (const width of [360, 1280]) {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(server.url);
			for (const title of [longTitle, unbrokenTitle]) {
				const tile = page.getByRole('link', { name: title, exact: true });
				await expect(tile).toHaveAccessibleName(title);
				await expect(tile.locator('.tile-title')).toHaveText(title);
				await expectThreeLines(tile.locator('.tile-title'));
			}
			const shortTitle = page
				.getByRole('link', { name: 'Books', exact: true })
				.locator('.tile-title');
			const dimensions = await shortTitle.evaluate((node) => ({
				height: node.getBoundingClientRect().height,
				lineHeight: parseFloat(getComputedStyle(node).lineHeight)
			}));
			expect(dimensions.height).toBeCloseTo(dimensions.lineHeight, 0);
		}
	}
});

test('search and enhanced details retain the full title and do not clamp group captions', async ({
	page
}) => {
	await page.goto(server.url);
	const search = page.getByRole('searchbox', { name: 'Search', exact: true });
	await expect(search).toBeEnabled();
	await search.fill('marshmallow');
	const result = page.getByRole('list', { name: 'Search results', exact: true }).getByRole('link');
	await expect(result).toHaveCount(1);
	await expect(result).toHaveAccessibleName(`${longTitle} ${groupLabel}`);
	await expectThreeLines(result.locator('.tile-title'));
	await expect(result.locator('.group-caption')).toHaveText(groupLabel);
	const caption = await result.locator('.group-caption').evaluate((node) => ({
		height: node.getBoundingClientRect().height,
		lineHeight: parseFloat(getComputedStyle(node).lineHeight),
		clamp: getComputedStyle(node).webkitLineClamp
	}));
	expect(caption.clamp).toBe('none');
	expect(caption.height).toBeGreaterThan(caption.lineHeight * 3);
	await search.press('Enter');
	const heading = page.getByRole('dialog').getByRole('heading', { name: longTitle, exact: true });
	await expect(heading).toHaveText(longTitle);
	await expect(heading).toHaveCSS('-webkit-line-clamp', 'none');
	await page.keyboard.press('Escape');
	await expect(result).toBeFocused();
});

test('title clamping and full native details work without JavaScript', async ({ browser }) => {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		viewport: { width: 360, height: 900 }
	});
	try {
		const page = await context.newPage();
		await page.goto(server.url);
		const tile = page.getByRole('link', { name: longTitle, exact: true });
		await expectThreeLines(tile.locator('.tile-title'));
		await tile.click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		const heading = page.getByRole('heading', { name: longTitle, exact: true });
		await expect(heading).toHaveText(longTitle);
		await expect(heading).toHaveCSS('-webkit-line-clamp', 'none');
	} finally {
		await context.close();
	}
});
