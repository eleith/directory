import { expect, test, type Locator } from '@playwright/test';
import { startServer, type TestServer } from './support/server.js';

const serviceURL = `https://archive.example.test/library?reference=${'household-'.repeat(24)}#latest`;
const configuration = `site:
  title: Detail presentation fixture
appearance:
  primary_light_color: '#123456'
  primary_dark_color: '#abcdef'
links:
  archive:
    title: Family archive
    url: ${serviceURL}
    description: Family photographs and documents, together in one place.
    group: Everyday
    tags: [FaMiLy, PHOTOGRAPHS]
    requires_auth: true
    internal_only: true
    admin_only: true
  books:
    title: Books
    url: https://books.example.test
`;
let server: TestServer;

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test.beforeAll(async () => {
	server = await startServer({ configuration, secret: null, origin: null });
	await server.ready();
});
test.afterAll(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
});

function luminance(color: string) {
	const channels = color.match(/\d+/g)!.slice(0, 3).map(Number);
	const linear = channels.map((channel) => {
		const value = channel / 255;
		if (value <= 0.04045) return value / 12.92;
		return ((value + 0.055) / 1.055) ** 2.4;
	});
	return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrastRatio(firstColor: string, secondColor: string) {
	const first = luminance(firstColor);
	const second = luminance(secondColor);
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function expectFooterBand(content: Locator) {
	const band = content.locator('.destination');
	await expect(band).toBeVisible();
	await expect(content).toHaveCSS('padding', '0px');
	await expect(content).toHaveCSS('overflow', 'hidden');
	await expect(content.locator('div.details')).toHaveCSS('padding-block-start', '20px');
	await expect(content.locator('div.details')).toHaveCSS('padding-block-end', '0px');
	await expect(content.locator('div.details')).toHaveCSS('padding-inline', '0px');
	await expect(content.locator('div.details')).toHaveCSS('gap', '24px');
	await expect(content.locator('.summary')).toHaveCSS('padding-inline', '20px');
	await expect(content.locator('.metadata')).toHaveCSS('gap', '24px');
	await expect(content.locator('.metadata')).toHaveCSS('padding', '0px');
	await expect(content.locator('.metadata')).toHaveCSS('border-width', '0px');
	await expect(band).toHaveCSS('border-width', '0px');
	await expect(band).toHaveCSS('padding-block-start', '24px');
	await expect(band).toHaveCSS('padding-block-end', '20px');
	await expect(band).toHaveCSS('padding-inline', '20px');
	const panelBox = (await content.boundingBox())!;
	const bandBox = (await band.boundingBox())!;
	const summaryBox = (await content.locator('.summary').boundingBox())!;
	const identityBox = (await content.locator('.identity').boundingBox())!;
	const rowBox = (await content.locator('.destination-address').boundingBox())!;
	expect(bandBox.x).toBeCloseTo(panelBox.x + 1, 0);
	expect(bandBox.x + bandBox.width).toBeCloseTo(panelBox.x + panelBox.width - 1, 0);
	expect(bandBox.width).toBeCloseTo(panelBox.width - 2, 0);
	expect(bandBox.y + bandBox.height).toBeCloseTo(panelBox.y + panelBox.height - 1, 0);
	expect(rowBox.x).toBeCloseTo(bandBox.x + 20, 0);
	expect(rowBox.x).toBeCloseTo(identityBox.x, 0);
	expect(rowBox.x + rowBox.width).toBeCloseTo(bandBox.x + bandBox.width - 20, 0);
	expect(rowBox.y - bandBox.y).toBeCloseTo(24, 0);
	expect(bandBox.y + bandBox.height - rowBox.y - rowBox.height).toBeCloseTo(20, 0);
	const tagGroup = content.locator('.metadata-group');
	if (await tagGroup.count()) {
		await expect(tagGroup).toHaveCSS('border-width', '0px');
		await expect(tagGroup).toHaveCSS('padding-block', '0px');
		await expect(tagGroup).toHaveCSS('padding-inline', '20px');
		await expect(tagGroup).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
		const tagGroupBox = (await tagGroup.boundingBox())!;
		const tagsBox = (await tagGroup
			.getByRole('list', { name: 'Tags', exact: true })
			.boundingBox())!;
		expect(tagsBox.x).toBeCloseTo(identityBox.x, 0);
		expect(tagsBox.width).toBeCloseTo(rowBox.width, 0);
		expect(tagsBox.y).toBeCloseTo(tagGroupBox.y, 0);
		expect(tagsBox.y + tagsBox.height).toBeCloseTo(tagGroupBox.y + tagGroupBox.height, 0);
		expect(tagsBox.y - summaryBox.y - summaryBox.height).toBeCloseTo(24, 0);
		expect(bandBox.y - tagsBox.y - tagsBox.height).toBeCloseTo(24, 0);
	} else {
		expect(bandBox.y - summaryBox.y - summaryBox.height).toBeCloseTo(24, 0);
	}
	const colors = await band.evaluate((node) => {
		const context = document.createElement('canvas').getContext('2d')!;
		function rgb(color: string) {
			context.clearRect(0, 0, 1, 1);
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
			return `rgb(${red}, ${green}, ${blue})`;
		}
		const cardStyle = getComputedStyle(node.closest('section.details')!);
		const card = rgb(cardStyle.backgroundColor);
		const cardAlpha = context.getImageData(0, 0, 1, 1).data[3];
		return {
			background: rgb(getComputedStyle(node).backgroundColor),
			expected: rgb(`color-mix(in srgb, ${cardStyle.color} 7%, ${cardStyle.backgroundColor})`),
			card,
			cardAlpha
		};
	});
	expect(colors.cardAlpha).toBe(255);
	expect(colors.background).toBe(colors.expected);
	expect(colors.background).not.toBe(colors.card);
	await expectNoHorizontalOverflow(content);
}

async function expectNoHorizontalOverflow(content: Locator) {
	const overflow = await content.evaluate((panel) => ({
		page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
		panel: panel.scrollWidth > panel.clientWidth,
		children: Array.from(
			panel.querySelectorAll('.scroll-content, div.details, .metadata-group, .destination')
		).some((node) => node.scrollWidth > node.clientWidth)
	}));
	expect(overflow).toEqual({ page: false, panel: false, children: false });
}

async function expectPresentation(content: Locator, primaryColor: string, interactive = true) {
	const identity = content.locator('.identity');
	const image = identity.locator('img');
	await expect(image).toHaveAttribute('width', '64');
	await expect
		.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
		.toBeGreaterThan(0);
	const identityBox = (await identity.boundingBox())!;
	const imageBox = (await image.boundingBox())!;
	const headingBox = (await identity.getByRole('heading').boundingBox())!;
	const category = identity.locator('.category');
	await expect(category).toHaveText('Everyday');
	const categoryBox = (await category.boundingBox())!;
	expect(headingBox.x).toBeGreaterThanOrEqual(imageBox.x + imageBox.width);
	expect(categoryBox.x).toBeCloseTo(headingBox.x, 0);
	expect(categoryBox.y).toBeGreaterThanOrEqual(headingBox.y + headingBox.height);
	await expect(content.locator('.description')).toHaveCSS('text-align', 'start');
	const destination = content.getByRole('textbox', { name: 'Destination', exact: true });
	await expect(destination).toHaveValue(serviceURL);
	await expect(destination).toBeEnabled();
	await expect(destination).toHaveJSProperty('readOnly', true);
	const action = content.getByRole('link', {
		name: 'Open Family archive (opens in a new tab)',
		exact: true
	});
	await expect(action).toHaveAttribute('href', serviceURL);
	await expect(action).toHaveText('Open');
	await expect(action.locator('svg, img')).toHaveCount(0);
	await expect(action).toHaveAttribute('target', '_blank');
	await expect(action).toHaveAttribute('rel', 'noopener noreferrer');
	await expect(action).toHaveCSS('background-color', primaryColor);
	const actionBox = (await action.boundingBox())!;
	const rowBox = (await content.locator('.destination-address').boundingBox())!;
	const fieldBox = (await destination.boundingBox())!;
	expect(rowBox.width).toBeCloseTo(identityBox.width, 0);
	expect(actionBox.width).toBeGreaterThanOrEqual(80);
	expect(actionBox.width).toBeLessThan(rowBox.width / 2);
	expect(actionBox.x).toBeGreaterThan(fieldBox.x + fieldBox.width);
	expect(Math.abs(actionBox.y - fieldBox.y)).toBeLessThanOrEqual(1);
	expect(actionBox.x + actionBox.width).toBeCloseTo(rowBox.x + rowBox.width, 0);
	const summaryBox = (await content.locator('.summary').boundingBox())!;
	expect(summaryBox.height).toBeGreaterThanOrEqual(128);
	expect(actionBox.y).toBeGreaterThanOrEqual(summaryBox.y + summaryBox.height);
	expect(actionBox.height).toBeGreaterThanOrEqual(48);
	const colors = await action.evaluate((node) => ({
		background: getComputedStyle(node).backgroundColor,
		foreground: getComputedStyle(node).color
	}));
	expect(contrastRatio(colors.background, colors.foreground)).toBeGreaterThanOrEqual(4.5);
	const metadata = content.locator('.metadata');
	const metadataBox = (await metadata.boundingBox())!;
	expect(metadataBox.y - summaryBox.y - summaryBox.height).toBeCloseTo(24, 0);
	await expectFooterBand(content);
	expect(rowBox.y).toBeGreaterThanOrEqual(metadataBox.y);
	expect(
		await content
			.locator('.open-service')
			.evaluate((node) => node === node.parentElement!.lastElementChild)
	).toBe(true);
	await expect(metadata.getByText('Tags', { exact: true })).toHaveCount(0);
	await expect(metadata.getByText('Destination', { exact: true })).toHaveCount(0);
	await expect(metadata.locator(':scope > .destination')).toHaveCount(1);
	await expect(metadata.locator('.metadata-group')).toHaveCount(1);
	const tags = metadata.getByRole('list', { name: 'Tags', exact: true });
	await expect(tags).toHaveCount(1);
	const destinationGroup = metadata.locator(':scope > .destination');
	const destinationBox = (await destinationGroup.boundingBox())!;
	expect(rowBox.y - destinationBox.y).toBeCloseTo(24, 0);
	await expect(tags).toHaveCSS('list-style-type', 'none');
	await expect(tags.locator('svg, img, a, input, [tabindex]')).toHaveCount(0);
	await expect(tags.locator('button.tag')).toHaveCount(interactive ? 5 : 0);
	await expect(tags.locator('span.tag')).toHaveCount(interactive ? 0 : 5);
	if (interactive) {
		const names = [
			'Filter by access: login',
			'Filter by access: internal',
			'Filter by access: admin',
			'Filter by tag: family',
			'Filter by tag: photographs'
		];
		for (const [index, name] of names.entries()) {
			await expect(tags.getByRole('button').nth(index)).toHaveAccessibleName(name);
		}
	}
	await expect(tags.getByRole('listitem')).toHaveText([
		'login',
		'internal',
		'admin',
		'family',
		'photographs'
	]);
	await expect(tags.getByRole('listitem', { name: 'admin only', exact: true })).toHaveText('admin');
	const chipColors = await metadata.locator('.metadata-group .tag').evaluateAll((chips) => {
		// Canvas resolves native CSS color expressions to sRGB for contrast measurements.
		const context = document.createElement('canvas').getContext('2d')!;
		function rgb(color: string) {
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
			return `rgb(${red}, ${green}, ${blue})`;
		}
		return chips.map((chip) => {
			const style = getComputedStyle(chip);
			return {
				foreground: rgb(style.color),
				background: rgb(style.backgroundColor),
				border: rgb(style.borderTopColor),
				borderWidth: style.borderTopWidth,
				borderStyle: style.borderTopStyle,
				cursor: style.cursor,
				card: rgb(getComputedStyle(chip.closest('section.details')!).backgroundColor)
			};
		});
	});
	expect(chipColors).toHaveLength(5);
	expect(chipColors.slice(0, 3)).toEqual(Array(3).fill(chipColors[0]));
	expect(chipColors.slice(3)).toEqual(Array(2).fill(chipColors[3]));
	expect(chipColors[0]!.background).not.toBe(chipColors[3]!.background);
	for (const colors of chipColors) {
		expect(colors.cursor).toBe(interactive ? 'pointer' : 'auto');
		expect(colors.borderWidth).toBe('1px');
		expect(colors.borderStyle).toBe('solid');
		expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(colors.border, colors.card)).toBeGreaterThanOrEqual(3);
		expect(contrastRatio(colors.border, colors.background)).toBeGreaterThanOrEqual(3);
	}
	for (const index of [0, 3]) {
		const chip = tags.locator('.tag').nth(index);
		const background = await chip.evaluate((node) => getComputedStyle(node).backgroundColor);
		await chip.hover({ position: { x: 4, y: 4 } });
		await expect(chip).toHaveCSS('text-decoration-line', 'none');
		await expect(chip).toHaveCSS('padding', '2px 12px');
		await expect(chip).toHaveCSS('font-size', '14px');
		expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(24);
		if (interactive) {
			await expect(chip).not.toHaveCSS('background-color', background);
			await expect(chip).toHaveCSS('cursor', 'pointer');
			const hover = await chip.evaluate((node, primaryColor) => {
				const style = getComputedStyle(node);
				const card = getComputedStyle(node.closest('section.details')!).backgroundColor;
				const source = node.matches('.ui-button--access-chip, .ui-chip--access')
					? primaryColor
					: style.color;
				const canvas = document.createElement('canvas').getContext('2d')!;
				function rgb(value: string) {
					canvas.fillStyle = value;
					canvas.fillRect(0, 0, 1, 1);
					return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3);
				}
				const point = node.getBoundingClientRect();
				return {
					actual: rgb(style.backgroundColor),
					expected: rgb(`color-mix(in srgb, ${source} 22%, ${card})`),
					hit: document.elementFromPoint(point.x + 4, point.y + 4) === node
				};
			}, primaryColor);
			expect(hover.actual).toEqual(hover.expected);
			expect(hover.hit).toBe(true);
		} else {
			await expect(chip).toHaveCSS('background-color', background);
		}
	}
	await expect(metadata.locator('.metadata-group').getByRole('link')).toHaveCount(0);
	return action;
}

for (const colorScheme of ['light', 'dark'] as const) {
	for (const width of [360, 1280]) {
		test(`compact identity, readable destination and primary action: ${width}px ${colorScheme}`, async ({
			page
		}) => {
			await page.emulateMedia({ colorScheme });
			await page.setViewportSize({ width, height: 900 });
			await page.goto(server.url);
			await page.getByRole('link', { name: 'Family archive', exact: true }).click();
			const dialog = page.getByRole('dialog', { name: 'Family archive', exact: true });
			await expect(dialog).toBeVisible();
			const primaryColor = colorScheme === 'light' ? 'rgb(18, 52, 86)' : 'rgb(171, 205, 239)';
			const action = await expectPresentation(dialog, primaryColor);
			const close = dialog.getByRole('button', { name: 'Close', exact: true });
			await expect(action).toBeFocused();
			await expect(close).toHaveCSS('min-width', '44px');
			await expect(close).toHaveCSS('min-height', '44px');
			await expect(dialog).toHaveCSS('border-top-left-radius', width < 768 ? '24px' : '12px');
			await expect(dialog).toHaveCSS('padding', '0px');
			await expect(dialog.locator('.scroll-content')).toHaveCSS('padding', '0px');
			const panelBox = (await dialog.boundingBox())!;
			const logoBox = (await dialog.locator('.identity img').boundingBox())!;
			const titleBox = (await dialog.getByRole('heading').boundingBox())!;
			const closeBox = (await close.boundingBox())!;
			expect(logoBox.y - panelBox.y).toBeLessThanOrEqual(24);
			expect(logoBox.x - panelBox.x).toBeCloseTo(21, 0);
			expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(closeBox.x);
			if (width >= 768) expect((await dialog.boundingBox())!.width).toBe(512);
			await page.keyboard.press('Shift+Tab');
			const urlField = dialog.getByRole('textbox', { name: 'Destination', exact: true });
			await expect(urlField).toBeFocused();
			await page.keyboard.press('ControlOrMeta+A');
			expect(
				await urlField.evaluate((node: HTMLInputElement) => [
					node.selectionStart,
					node.selectionEnd
				])
			).toEqual([0, serviceURL.length]);
			await page.keyboard.type('not editable');
			await expect(urlField).toHaveValue(serviceURL);
			await page.keyboard.press('Tab');
			await expect(action).toBeFocused();
			await expect(action).toHaveCSS('outline-width', '2px');
			await page.keyboard.press('Tab');
			await expect(close).toBeFocused();
			const chips = await dialog.locator('button.tag').all();
			for (const chip of chips) {
				await page.keyboard.press('Tab');
				await expect(chip).toBeFocused();
				await expect(chip).toHaveAttribute('type', 'button');
				await expect(chip).toHaveCSS('outline-style', 'solid');
				await expect(chip).toHaveCSS('outline-width', '2px');
				await expect(chip).toHaveCSS('outline-offset', '-2px');
				await expect(chip).toHaveCSS('outline-color', primaryColor);
				const chipBox = (await chip.boundingBox())!;
				expect(chipBox.width).toBeGreaterThanOrEqual(24);
				expect(chipBox.height).toBeGreaterThanOrEqual(24);
			}
			await page.keyboard.press('Tab');
			await expect(urlField).toBeFocused();
			await page.keyboard.press('Tab');
			await expect(action).toBeFocused();
			await page.keyboard.press('Shift+Tab');
			await expect(urlField).toBeFocused();
			for (const chip of chips.toReversed()) {
				await page.keyboard.press('Shift+Tab');
				await expect(chip).toBeFocused();
			}
			await page.keyboard.press('Shift+Tab');
			await expect(close).toBeFocused();
			await page.keyboard.press('Shift+Tab');
			await expect(action).toBeFocused();
			const scroll = (await dialog.locator('.scroll-content').boundingBox())!;
			const actionBox = (await action.boundingBox())!;
			expect(actionBox.x - 4).toBeGreaterThanOrEqual(scroll.x - 1);
			expect(actionBox.x + actionBox.width + 4).toBeLessThanOrEqual(scroll.x + scroll.width + 1);
			await page.keyboard.press('Escape');
			await expect(page.getByRole('link', { name: 'Family archive', exact: true })).toBeFocused();
		});
	}
}

test('minimal bookmarks retain a balanced summary and destination-only metadata', async ({
	page
}) => {
	const app = await startServer({
		configuration:
			'site:\n  title: Minimal details\nlinks:\n  books:\n    title: Books\n    url: https://books.example.test\n',
		secret: null,
		origin: null
	});
	try {
		await app.ready();
		await page.goto(app.url);
		await page.getByRole('link', { name: 'Books', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Books', exact: true });
		await expect(dialog).toBeVisible();
		const summary = (await dialog.locator('.summary').boundingBox())!;
		expect(summary.height).toBeGreaterThanOrEqual(128);
		await expect(dialog.getByText('Destination', { exact: true })).toHaveCount(0);
		await expect(dialog.getByRole('textbox', { name: 'Destination', exact: true })).toHaveValue(
			'https://books.example.test'
		);
		await expect(dialog.locator('.metadata .tags')).toHaveCount(0);
		await expect(dialog.locator('.metadata-group')).toHaveCount(0);
		await expect(dialog.locator('.metadata')).toHaveCSS('border-width', '0px');
		await expect(dialog.locator('.metadata')).toHaveCSS('padding', '0px');
		await expectFooterBand(dialog);
		const destination = (await dialog.locator('.destination-address').boundingBox())!;
		expect(destination.y - summary.y - summary.height).toBeCloseTo(48, 0);
		await expect(dialog.locator('.description')).toHaveCount(0);
		await expect(
			dialog.getByRole('link', { name: 'Open Books (opens in a new tab)', exact: true })
		).toBeVisible();
	} finally {
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});

test('long summaries grow naturally and keep the autofocus action visible', async ({ page }) => {
	const app = await startServer({
		configuration: configuration.replace(
			'Family photographs and documents, together in one place.',
			JSON.stringify('Household reference notes remain readable while scrolling.\n'.repeat(30))
		),
		secret: null,
		origin: null
	});
	try {
		await app.ready();
		await page.setViewportSize({ width: 360, height: 700 });
		await page.goto(app.url);
		await page.getByRole('link', { name: 'Family archive', exact: true }).click();
		const dialog = page.getByRole('dialog');
		const action = dialog.getByRole('link', {
			name: 'Open Family archive (opens in a new tab)',
			exact: true
		});
		await expect(action).toBeFocused();
		await expect(action).toBeInViewport();
		expect((await dialog.locator('.summary').boundingBox())!.height).toBeGreaterThan(128);
		const close = dialog.getByRole('button', { name: 'Close', exact: true });
		await expect(close).toBeInViewport();
		await page.keyboard.press('Shift+Tab');
		await expect(dialog.getByRole('textbox', { name: 'Destination', exact: true })).toBeFocused();
		for (const chip of (await dialog.locator('button.tag').all()).toReversed()) {
			await page.keyboard.press('Shift+Tab');
			await expect(chip).toBeFocused();
			await expect(chip).toBeInViewport();
		}
		await page.keyboard.press('Shift+Tab');
		await expect(close).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('link', { name: 'Family archive', exact: true })).toBeFocused();
	} finally {
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});

test('long unbroken tags wrap within the phone scrollport and keep actions reachable', async ({
	page
}) => {
	const longTag = 'HouseholdArchive'.repeat(40);
	const app = await startServer({
		configuration: configuration.replace('FaMiLy, PHOTOGRAPHS', `FaMiLy, ${longTag}`),
		secret: null,
		origin: null
	});
	try {
		await app.ready();
		await page.setViewportSize({ width: 360, height: 700 });
		await page.goto(app.url);
		await page.getByRole('link', { name: 'Family archive', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Family archive', exact: true });
		const action = dialog.getByRole('link', {
			name: 'Open Family archive (opens in a new tab)',
			exact: true
		});
		await expect(action).toBeFocused();
		await expect(action).toBeInViewport();
		const tagGroup = dialog.locator('.metadata-group');
		await tagGroup.scrollIntoViewIfNeeded();
		await expect(tagGroup).toBeVisible();
		const chip = tagGroup.locator('.tag').last();
		await expect(chip).toHaveText(longTag.toLowerCase());
		const chipBox = (await chip.boundingBox())!;
		const lineHeight = await chip.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
		expect(chipBox.height).toBeGreaterThan(lineHeight * 2);
		const tagsBox = (await tagGroup
			.getByRole('list', { name: 'Tags', exact: true })
			.boundingBox())!;
		expect(chipBox.width).toBeLessThanOrEqual(tagsBox.width);
		const tagGroupBox = (await tagGroup.boundingBox())!;
		const scrollport = await dialog.locator('.scroll-content').evaluate((node) => ({
			left: node.getBoundingClientRect().left + node.clientLeft,
			width: node.clientWidth
		}));
		expect(tagGroupBox.x).toBeCloseTo(scrollport.left, 0);
		expect(tagGroupBox.width).toBeCloseTo(scrollport.width, 0);
		const footerBox = (await dialog.locator('.destination').boundingBox())!;
		const detailsBox = (await dialog.locator('div.details').boundingBox())!;
		expect(footerBox.x).toBeCloseTo(scrollport.left, 0);
		expect(footerBox.width).toBeCloseTo(scrollport.width, 0);
		expect(footerBox.y + footerBox.height).toBeCloseTo(detailsBox.y + detailsBox.height, 0);
		await expectNoHorizontalOverflow(dialog);
		await page.keyboard.press('Shift+Tab');
		const destination = dialog.getByRole('textbox', { name: 'Destination', exact: true });
		await expect(destination).toBeFocused();
		await expect(destination).toBeInViewport();
		await expect(destination).toHaveJSProperty('readOnly', true);
		await expect(destination).toHaveValue(serviceURL);
		await page.keyboard.press('Tab');
		await expect(action).toBeFocused();
		await expect(action).toBeInViewport();
		await expect(action).toHaveCSS('outline-width', '2px');
	} finally {
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});

test('plain details share the presentation and action without JavaScript', async ({ browser }) => {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		viewport: { width: 360, height: 900 }
	});
	try {
		const page = await context.newPage();
		await page.goto(`${server.url}/?link=archive`);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		const content = page.locator('section.details');
		const back = content.getByRole('link', { name: 'Back to directory', exact: true });
		await expect(back).toBeVisible();
		await expect(back).toHaveCSS('margin', '20px 20px 12px');
		const backBox = (await back.boundingBox())!;
		const summaryBox = (await content.locator('.summary').boundingBox())!;
		expect(summaryBox.y - backBox.y - backBox.height).toBeCloseTo(32, 0);
		await expectPresentation(content, 'rgb(18, 52, 86)', false);
	} finally {
		await context.close();
	}
});
