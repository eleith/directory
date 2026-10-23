import { expect, test, type Locator, type Page } from '@playwright/test';
import { startServer, type TestServer } from './support/server.js';

const groups = [
	{
		label: 'Shared collections',
		titles: [
			'Photo roll',
			'HouseholdDocumentArchiveWithAnUnbrokenTitle',
			'Letters',
			'School projects',
			'Travel albums',
			'Notebook shelf',
			'Scanned receipts',
			'Shared folders',
			'Laptop recovery copies',
			'Device transfers'
		]
	},
	{
		label: 'Listen and read',
		titles: [
			'Record collection',
			'Film shelf',
			'Ebooks',
			'Listening queue',
			'Article clippings',
			'Radio recordings',
			'Library suggestions'
		]
	},
	{
		label: 'Daily routines',
		titles: ['Room lights', 'Meal plans', 'Appointments', 'Pantry', 'Rain gauge', 'Solar readings']
	},
	{
		label: 'Making and repairing',
		titles: [
			'Repair instructions',
			'Print jobs',
			'Spare parts',
			'Project board',
			'Equipment records'
		]
	},
	{
		label: 'Service maintenance',
		titles: ['Network map', 'Disk health', 'Service console', 'Name records']
	}
];
const bookmarks = groups.flatMap((group, groupIndex) =>
	group.titles.map((title, index) => ({
		id: `layout-${groupIndex}-${index}`,
		title,
		group: group.label
	}))
);
const configuration = `site:
  title: Shared household services and reference shelves
  description: Independent page geometry fixture.
  footer: Ask the household caretaker for help.
links:
${bookmarks
	.map(
		(bookmark) => `  ${bookmark.id}:
    title: ${bookmark.title}
    url: https://layout.example.test/${bookmark.id}
    group: ${bookmark.group}
    tags: canvasfixture`
	)
	.join('\n')}
`;
let server: TestServer;

test.beforeAll(async () => {
	server = await startServer({ configuration, secret: null, origin: null });
	await server.ready();
});
test.afterAll(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
});

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search', exact: true });
const results = (page: Page) => page.getByRole('list', { name: 'Search results', exact: true });

async function expectCanvas(page: Page, grids: Locator) {
	const positions = await grids.evaluateAll((elements) =>
		elements.map((element) => {
			const grid = element.getBoundingClientRect();
			const tiles = Array.from(element.querySelectorAll('a.tile'), (tile) => {
				const { left, top, right } = tile.getBoundingClientRect();
				const style = getComputedStyle(tile);
				return {
					left,
					top,
					right,
					contentLeft: left + parseFloat(style.paddingInlineStart),
					contentRight: right - parseFloat(style.paddingInlineEnd)
				};
			});
			return { left: grid.left, width: grid.width, tiles };
		})
	);
	const firstGrid = positions[0]!;
	const firstRow = firstGrid.tiles.filter(
		(tile) => Math.abs(tile.top - firstGrid.tiles[0]!.top) < 1
	);
	const firstTrack = firstRow[0]!;
	const lastTrack = firstRow.at(-1)!;
	const tileInlinePadding = firstTrack.contentLeft - firstTrack.left;
	const containerContentWidth = firstGrid.width - tileInlinePadding * 2;
	const viewportWidth = await page.evaluate(() => innerWidth);
	expect((firstTrack.left + lastTrack.right) / 2).toBeCloseTo(viewportWidth / 2, 0);
	const rowWidth = lastTrack.right - firstTrack.left;
	expect(firstTrack.left).toBeCloseTo(firstGrid.left + (firstGrid.width - rowWidth) / 2, 0);
	if (viewportWidth >= 768) {
		expect(lastTrack.right).toBeCloseTo(firstGrid.left + firstGrid.width, 0);
	} else {
		const padding = await page
			.locator('main')
			.evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft));
		expect(firstGrid.left + tileInlinePadding).toBeCloseTo(padding, 0);
		expect(firstGrid.width).toBeCloseTo(viewportWidth - padding * 2 + tileInlinePadding * 2, 0);
	}
	for (const grid of positions) {
		expect(grid.left).toBeCloseTo(firstGrid.left, 0);
		expect(grid.width).toBeCloseTo(firstGrid.width, 0);
		for (const [index, tile] of grid.tiles.entries()) {
			expect(tile.left).toBeCloseTo(firstRow[index % firstRow.length]!.left, 0);
		}
	}
	const edges = await page
		.locator('main > header, main > footer, main > .search-feedback, main > .details, .groups h2')
		.evaluateAll((nodes) =>
			nodes.map((node) => {
				const { left, width } = node.getBoundingClientRect();
				return { left, width };
			})
		);
	for (const edge of edges) {
		expect(edge.left).toBeCloseTo(firstGrid.left + tileInlinePadding, 0);
		expect(edge.width).toBeCloseTo(containerContentWidth, 0);
	}
	const sizing = await page.locator('main').evaluate((node) => {
		const style = getComputedStyle(node);
		return {
			rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
			gap: parseFloat(style.columnGap) || 0,
			available: node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
		};
	});
	const columnGap = viewportWidth >= 768 ? 2 * sizing.rem : sizing.rem;
	if (viewportWidth >= 768) expect(sizing.gap).toBe(columnGap);
	const trackWidth = (viewportWidth >= 768 ? 7 : 6) * sizing.rem;
	expect(firstRow).toHaveLength(
		Math.floor((sizing.available + columnGap) / (trackWidth + columnGap))
	);
	for (const grid of positions) {
		for (const [index, tile] of grid.tiles.entries()) {
			expect(tile.contentRight - tile.contentLeft).toBeCloseTo(trackWidth, 0);
			expect(tile.contentLeft).toBeCloseTo(
				firstTrack.contentLeft + (index % firstRow.length) * (trackWidth + columnGap),
				0
			);
		}
	}
	const clearances = await page.locator('.groups section').evaluateAll((sections) =>
		sections.map((section) => {
			const heading = section.querySelector('h2')?.getBoundingClientRect();
			const tiles = Array.from(section.querySelectorAll('a.tile'));
			return {
				headingBottom: heading?.bottom ?? 0,
				firstTileTop: tiles[0]!.getBoundingClientRect().top
			};
		})
	);
	for (const clearance of clearances) {
		expect(clearance.firstTileTop - clearance.headingBottom).toBeGreaterThanOrEqual(sizing.rem - 1);
	}
	const feedback = page.locator('.search-feedback');
	if ((await feedback.innerText()).trim()) {
		const feedbackBox = await feedback.boundingBox();
		expect(firstTrack.top - feedbackBox!.y - feedbackBox!.height).toBeGreaterThanOrEqual(
			sizing.rem - 1
		);
	}
	const footerClearance = await page.locator('main').evaluate((node) => {
		const footer = node.querySelector('footer')!.getBoundingClientRect();
		const tileBottoms = Array.from(
			node.querySelectorAll('a.tile'),
			(tile) => tile.getBoundingClientRect().bottom
		);
		return footer.top - Math.max(...tileBottoms);
	});
	expect(footerClearance).toBeGreaterThanOrEqual(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	return firstRow.length;
}

async function expectContinuousCells(grids: Locator, columns: number) {
	for (const grid of await grids.all()) {
		await expect(grid).toHaveCSS('gap', '0px');
		const cells = await grid.locator('a.tile').evaluateAll((tiles) =>
			tiles.map((tile) => {
				const box = tile.getBoundingClientRect();
				const style = getComputedStyle(tile);
				const image = tile.querySelector('img')!.getBoundingClientRect();
				const title = tile.querySelector('span')!.getBoundingClientRect();
				return {
					left: box.left,
					right: box.right,
					top: box.top,
					bottom: box.bottom,
					inlinePadding: parseFloat(style.paddingInlineStart),
					blockPadding: parseFloat(style.paddingBlockStart),
					imageWidth: image.width,
					imageOffset: image.left + image.width / 2 - (box.left + box.width / 2),
					titleOffset: title.left + title.width / 2 - (box.left + box.width / 2)
				};
			})
		);
		for (const [index, cell] of cells.entries()) {
			expect(cell.inlinePadding).toBeGreaterThanOrEqual(8);
			expect(cell.blockPadding).toBe(12);
			expect(cell.imageWidth).toBe(64);
			expect(cell.imageOffset).toBeCloseTo(0, 1);
			expect(cell.titleOffset).toBeCloseTo(0, 1);
			if (index % columns > 0) {
				expect(Math.abs(cell.left - cells[index - 1]!.right)).toBeLessThanOrEqual(2);
			}
			if (index >= columns) {
				expect(Math.abs(cell.top - cells[index - columns]!.bottom)).toBeLessThanOrEqual(2);
			}
		}
	}
}

async function paddingPoint(tile: Locator, edge: 'inline' | 'block') {
	await tile.scrollIntoViewIfNeeded();
	return tile.evaluate((node, edge) => {
		const box = node.getBoundingClientRect();
		let x = box.left + box.width / 2;
		let y = box.top + 2;
		if (edge === 'inline') {
			x = box.left + 2;
			y = box.top + box.height / 2;
		}
		return {
			x,
			y,
			hit: document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href')
		};
	}, edge);
}

async function expectResultColumns(page: Page, columns: number) {
	const resultList = results(page);
	await expect(resultList).toHaveCount(1);
	await expect(page.getByRole('grid')).toHaveCount(0);
	await expect(resultList.getByRole('listitem')).toHaveCount(32);
	await expect(resultList.getByRole('link')).toHaveCount(32);
	await expect
		.poll(() =>
			resultList.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
		)
		.toBe(columns);
	await expect(resultList.locator('a[tabindex]')).toHaveCount(0);
	expect(
		await resultList
			.getByRole('link')
			.evaluateAll((links) => links.every((link) => link.tabIndex === 0))
	).toBe(true);
}

for (const colorScheme of ['light', 'dark'] as const) {
	for (const width of [360, 390, 414, 768, 1280, 1920, 2560]) {
		test(`shared track canvas for uneven groups and results: ${width}px ${colorScheme}`, async ({
			page
		}) => {
			await page.emulateMedia({ colorScheme });
			await page.setViewportSize({ width, height: 1000 });
			await page.goto(server.url);
			await expect(search(page)).toBeEnabled();
			const sections = page.locator('.groups section');
			await expect(sections).toHaveCount(groups.length);
			await expect(sections.getByRole('heading')).toHaveText(groups.map((group) => group.label));
			for (const [index, group] of groups.entries()) {
				await expect(sections.nth(index).getByRole('link')).toHaveCount(group.titles.length);
			}
			const tiles = sections.getByRole('link');
			await expect(tiles).toHaveCount(32);
			await expect(tiles.locator('span')).toHaveText(bookmarks.map((bookmark) => bookmark.title));
			expect(
				await tiles.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')))
			).toEqual(bookmarks.map((bookmark) => `/?link=${bookmark.id}`));
			const columns = await expectCanvas(page, page.locator('.groups .link-grid'));
			await expectContinuousCells(page.locator('.groups .link-grid'), columns);
			if (width <= 414) {
				expect(columns).toBe(3);
				await expect(search(page)).toHaveCSS('width', `${width - 32}px`);
			}
			if (width >= 1280) expect(columns).toBe(8);
			await search(page).fill('canvasfixture');
			await expect(results(page).getByRole('link')).toHaveCount(32);
			await expectResultColumns(page, columns);
			expect(await expectCanvas(page, results(page))).toBe(columns);
			await expectContinuousCells(results(page), columns);
			await search(page).press('ArrowDown');
			await expect(results(page).getByRole('link').first()).toBeFocused();
			await page.keyboard.press('ArrowDown');
			await expect(results(page).getByRole('link').nth(columns)).toBeFocused();
		});
	}
}

for (const width of [360, 390, 768, 1280, 1920, 2560]) {
	test(`native padded cells hover and open the correct details at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 1000 });
		for (const filtered of [false, true]) {
			await page.goto(server.url);
			await expect(search(page)).toBeEnabled();
			let tileList = page.locator('.groups .link-grid').first();
			if (filtered) {
				await search(page).fill('canvasfixture');
				tileList = results(page);
				await expect(tileList.getByRole('link')).toHaveCount(32);
			}
			const columns = await expectCanvas(page, tileList);
			const tiles = tileList.getByRole('link');
			for (const [edge, index] of [
				['inline', 1],
				['block', columns]
			] as const) {
				const tile = tiles.nth(index);
				const href = await tile.getAttribute('href');
				const point = await paddingPoint(tile, edge);
				expect(point.hit).toBe(href);
				for (const colorScheme of ['light', 'dark'] as const) {
					await page.emulateMedia({ colorScheme });
					await page.mouse.move(point.x, point.y);
					await expect(tile).toHaveCSS(
						'background-color',
						colorScheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(27, 32, 34)'
					);
					await expect(tiles.first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
				}
				await page.mouse.click(point.x, point.y);
				await expect(page).toHaveURL(server.url + href);
				const dialog = page.getByRole('dialog');
				await expect(dialog).toBeVisible();
				const title = await tile.locator('span').textContent();
				await expect(dialog.getByRole('heading', { name: title!, exact: true })).toBeVisible();
				await page.keyboard.press('Escape');
				await expect(dialog).toHaveCount(0);
				await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
				await expect(tile).toBeFocused();
				await page.keyboard.press('Tab');
				await page.keyboard.press('Shift+Tab');
				await expect(tile).toBeFocused();
				await expect(tile).toHaveCSS('outline-style', 'solid');
				await expect(tile).toHaveCSS('outline-width', '2px');
				await expect(tile).toHaveCSS('outline-offset', '2px');
				const outline = await tile.evaluate((node) => {
					const box = node.getBoundingClientRect();
					const clippingAncestors = [];
					for (let parent = node.parentElement; parent; parent = parent.parentElement) {
						const style = getComputedStyle(parent);
						if (
							[style.overflowX, style.overflowY].some((value) => ['hidden', 'clip'].includes(value))
						) {
							clippingAncestors.push(parent.tagName);
						}
					}
					return { left: box.left - 4, right: box.right + 4, clippingAncestors };
				});
				expect(outline.left).toBeGreaterThanOrEqual(0);
				expect(outline.right).toBeLessThanOrEqual(width);
				expect(outline.clippingAncestors).toEqual([]);
			}
		}
	});
}

for (const filtered of [false, true]) {
	test(`padded cell edges preserve native new tabs: filtered ${filtered}`, async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width: 360, height: 1000 });
		await page.goto(server.url);
		await expect(search(page)).toBeEnabled();
		let tileList = page.locator('.groups .link-grid').first();
		if (filtered) {
			await search(page).fill('canvasfixture');
			tileList = results(page);
			await expect(tileList.getByRole('link')).toHaveCount(32);
		}
		const tile = tileList.getByRole('link').nth(1);
		await expect(tile).toHaveAccessibleName(
			filtered ? `${bookmarks[1]!.title} ${groups[0]!.label}` : bookmarks[1]!.title
		);
		await expect(tile).toHaveAttribute('data-sveltekit-preload-data', 'off');
		for (const button of ['left', 'middle'] as const) {
			const point = await paddingPoint(tile, 'inline');
			const popup = context.waitForEvent('page');
			if (button === 'left') await page.keyboard.down('Control');
			try {
				await page.mouse.click(point.x, point.y, { button });
			} finally {
				if (button === 'left') await page.keyboard.up('Control');
			}
			const opened = await popup;
			await expect(opened).toHaveURL(server.url + (await tile.getAttribute('href')));
			await opened.close();
			await expect(page).toHaveURL(`${server.url}/`);
			await expect(page.getByRole('dialog')).toHaveCount(0);
		}
	});
}

test('resizing the full result canvas preserves focus, nodes and visual columns', async ({
	page
}) => {
	await page.setViewportSize({ width: 2560, height: 1000 });
	await page.goto(server.url);
	await search(page).fill('canvasfixture');
	await expectResultColumns(page, 8);
	const links = results(page).getByRole('link');
	const originalLinks = await links.elementHandles();
	const images = links.locator('img');
	await expect(images).toHaveCount(32);
	const originalImages = await images.elementHandles();
	const focused = links.nth(10);
	await focused.focus();
	for (const width of [360, 1920, 390, 768, 1280, 2560]) {
		await page.setViewportSize({ width, height: 1000 });
		const columns = await results(page).evaluate(
			(node) => getComputedStyle(node).gridTemplateColumns.split(' ').length
		);
		await expectResultColumns(page, columns);
		await expect(images).toHaveCount(32);
		await expect(focused).toBeFocused();
		expect(await originalLinks[10]!.evaluate((node) => node.isConnected)).toBe(true);
		expect(
			await links.evaluateAll(
				(nodes, originals) => nodes.every((node, index) => node === originals[index]),
				originalLinks
			)
		).toBe(true);
		expect(
			await images.evaluateAll(
				(nodes, originals) => nodes.every((node, index) => node === originals[index]),
				originalImages
			)
		).toBe(true);
		expect(await expectCanvas(page, results(page))).toBe(columns);
	}
	await page.keyboard.press('Home');
	await expect(results(page).getByRole('link').nth(8)).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(search(page)).toBeFocused();
	await expect(search(page)).toHaveValue('canvasfixture');
	await page.getByRole('button', { name: 'Clear search', exact: true }).click();
	await expect(search(page)).toBeFocused();
	await expect(results(page)).toHaveCount(0);
	await expect(page.getByRole('listitem')).toHaveCount(32);
	await expectCanvas(page, page.locator('.groups .link-grid'));
});

test('plain native details retain the full canvas without JavaScript', async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		for (const width of [360, 1280, 2560]) {
			await page.setViewportSize({ width, height: 1000 });
			await page.goto(`${server.url}/?link=layout-0-0`);
			await expect(
				page.getByRole('link', { name: 'Back to directory', exact: true })
			).toHaveAttribute('href', '/');
			await expect(page.getByRole('dialog')).toHaveCount(0);
			await expect(page.locator('.groups').getByRole('listitem')).toHaveCount(32);
			const columns = await expectCanvas(page, page.locator('.groups .link-grid'));
			for (const [edge, index] of [
				['inline', 1],
				['block', columns]
			] as const) {
				await page.goto(server.url);
				const tile = page.locator('.groups .link-grid').first().getByRole('link').nth(index);
				const href = await tile.getAttribute('href');
				const point = await paddingPoint(tile, edge);
				expect(point.hit).toBe(href);
				await page.mouse.click(point.x, point.y);
				await expect(page).toHaveURL(server.url + href);
				await expect(page.getByRole('dialog')).toHaveCount(0);
				await expect(page.locator('.details h2')).toHaveText(bookmarks[index]!.title);
			}
		}
	} finally {
		await context.close();
	}
});

test('compact tiles keep heading and feedback clear of hover and focus surfaces', async ({
	page
}) => {
	for (const width of [360, 1280]) {
		await page.setViewportSize({ width, height: 1000 });
		await page.goto(server.url);
		await expect(search(page)).toBeEnabled();
		const tile = page.locator('.groups .link-grid').first().getByRole('link').first();
		const box = await tile.boundingBox();
		const heading = await page.locator('.groups h2').first().boundingBox();
		const expectedWidth = width < 768 ? 112 : 144;
		const maximumRatio = width < 768 ? 1.45 : 1.15;
		expect(box!.width).toBe(expectedWidth);
		expect(box!.height / box!.width).toBeLessThanOrEqual(maximumRatio);
		await tile.focus();
		await expect(tile).toHaveCSS('outline-width', '2px');
		await expect(tile).toHaveCSS('outline-offset', '2px');
		expect(box!.y - 4 - heading!.y - heading!.height).toBeGreaterThanOrEqual(12);
		await search(page).fill('canvasfixture');
		const firstResult = results(page).getByRole('link').first();
		await expect(firstResult).toBeVisible();
		const resultBox = await firstResult.boundingBox();
		const feedback = await page.locator('.search-feedback').boundingBox();
		expect(resultBox!.y - 4 - feedback!.y - feedback!.height).toBeGreaterThanOrEqual(12);
	}
});

test('column thresholds follow compact phone and wider desktop tracks', async ({ page }) => {
	await page.goto(server.url);
	await expect(search(page)).toBeEnabled();
	for (const width of [
		351, 352, 463, 464, 575, 576, 687, 688, 767, 768, 895, 896, 1039, 1040, 1183, 1184
	]) {
		await page.setViewportSize({ width, height: 1000 });
		await expectCanvas(page, page.locator('.groups .link-grid'));
	}
});

test('enlarged text and unbroken branding wrap inside the shared canvas', async ({ page }) => {
	await page.goto(server.url);
	await page.getByRole('heading', { level: 1 }).evaluate((node) => {
		node.textContent = 'HouseholdServicesAndReferenceShelvesWithAnUnbrokenBrandName';
	});
	await page.evaluate(() => {
		document.documentElement.style.fontSize = '125%';
	});
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme });
		for (const width of [360, 390, 768, 1280, 1920, 2560]) {
			await page.setViewportSize({ width, height: 1000 });
			await expectCanvas(page, page.locator('.groups .link-grid'));
			const brand = await page.locator('header > div').first().boundingBox();
			const title = await page.getByRole('heading', { level: 1 }).boundingBox();
			expect(title!.x + title!.width).toBeLessThanOrEqual(brand!.x + brand!.width + 1);
		}
	}
});
