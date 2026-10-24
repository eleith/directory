import { expect, test, type Locator } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialsAuth } from './support/configuration.js';
import { directoryScript } from './support/details.js';
import { startServer, type TestServer } from './support/server.js';

const serviceURL = `https://interaction.example.test/archive?reference=${'full-value-'.repeat(20)}#latest`;
const configuration = `site:
  title: Hover and focus fixture
appearance:
  primary_light_color: '#13579b'
  primary_dark_color: '#e2c4a6'
links:
  archive:
    title: Reference archive
    url: ${serviceURL}
    group: Shared references
    tags: interactionfixture
    logo_path: /public/service.svg
  notebook:
    title: Notebook
    url: https://interaction.example.test/notebook
    group: Shared references
    tags: interactionfixture
`;
let server: TestServer;
let publicDir: string;

test.beforeAll(async () => {
	publicDir = await mkdtemp(join(tmpdir(), 'directory-hover-focus-'));
	await writeFile(
		join(publicDir, 'service.svg'),
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#369" d="M0 0h64v64H0z"/></svg>'
	);
	server = await startServer({ configuration, publicDir, secret: null, origin: null });
	await server.ready();
});
test.afterAll(async () => {
	try {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	} finally {
		await rm(publicDir, { recursive: true, force: true });
	}
});

async function fieldPalette(control: Locator) {
	return control.evaluate((node) => {
		const probe = document.createElement('span');
		probe.style.display = 'none';
		node.parentElement!.append(probe);
		const canvas = document.createElement('canvas').getContext('2d')!;
		function rgb(color: string) {
			canvas.clearRect(0, 0, 1, 1);
			canvas.fillStyle = color;
			canvas.fillRect(0, 0, 1, 1);
			return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3);
		}
		probe.style.background = 'color-mix(in srgb, var(--color-text) 8%, var(--color-surface-card))';
		const hover = rgb(getComputedStyle(probe).backgroundColor);
		probe.style.background =
			'color-mix(in srgb, var(--color-primary) 16%, var(--color-surface-card))';
		const focus = rgb(getComputedStyle(probe).backgroundColor);
		probe.style.color = 'var(--color-primary)';
		probe.style.borderColor = 'var(--color-border-strong)';
		const style = getComputedStyle(probe);
		const palette = {
			hover,
			focus,
			primary: style.color,
			strong: style.borderTopColor
		};
		probe.remove();
		return palette;
	});
}

async function expectBackground(control: Locator, expected: number[]) {
	await expect
		.poll(() =>
			control.evaluate((node) => {
				const canvas = document.createElement('canvas').getContext('2d')!;
				canvas.fillStyle = getComputedStyle(node).backgroundColor;
				canvas.fillRect(0, 0, 1, 1);
				return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3);
			})
		)
		.toEqual(expected);
}

async function expectInsetFocus(control: Locator, primary: string) {
	await expect(control).toHaveCSS('outline-style', 'solid');
	await expect(control).toHaveCSS('outline-width', '2px');
	await expect(control).toHaveCSS('outline-color', primary);
	await expect(control).toHaveCSS('outline-offset', '-2px');
	await expect(control).toHaveCSS('box-shadow', 'none');
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
	test(`native padding hover preserves tile geometry with motion ${reducedMotion}`, async ({
		page
	}) => {
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme, reducedMotion });
			for (const width of [360, 1280]) {
				await page.setViewportSize({ width, height: 900 });
				await page.mouse.move(0, 0);
				await page.goto(server.url);
				await page
					.getByRole('searchbox', { name: 'Search', exact: true })
					.fill('tag:interactionfixture');
				const results = page.getByRole('list', { name: 'Search results', exact: true });
				await expect(results.getByRole('link')).toHaveCount(2);
				const tile = results.getByRole('link').first();
				const image = tile.locator('img');
				const motionSurface = tile.locator('.tile-icon');
				await expect
					.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
					.toBeGreaterThan(0);
				await tile.scrollIntoViewIfNeeded();
				const anchorBox = (await tile.boundingBox())!;
				const imageBox = (await image.boundingBox())!;
				await expect(motionSurface).toHaveJSProperty('tagName', 'DIV');
				expect(await motionSurface.boundingBox()).toEqual(imageBox);
				expect(imageBox.width).toBe(64);
				expect(imageBox.height).toBe(64);
				expect(anchorBox.width).toBe(width === 360 ? 112 : 144);
				await expect(tile).toHaveAttribute('href', '/?link=archive&q=tag%3Ainteractionfixture');
				for (const edge of ['inline', 'block']) {
					await page.mouse.move(0, 0);
					await expect(image).toHaveCSS('transform', 'none');
					await expect(image).toHaveCSS('filter', 'none');
					await expect(motionSurface).toHaveCSS('transform', 'none');
					await expect(motionSurface).toHaveCSS('filter', 'none');
					let x = anchorBox.x + anchorBox.width / 2;
					let y = anchorBox.y + 2;
					if (edge === 'inline') {
						x = anchorBox.x + 2;
						y = anchorBox.y + anchorBox.height / 2;
					}
					expect(
						await tile.evaluate(
							(node, point) => document.elementFromPoint(point.x, point.y)?.closest('a') === node,
							{ x, y }
						)
					).toBe(true);
					await page.mouse.move(x, y);
					await expect(tile).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
					await expect(tile).toHaveCSS('border-width', '0px');
					await expect(tile).toHaveCSS('text-decoration-line', 'none');
					await expect(tile.locator('.tile-title')).toHaveCSS('text-decoration-line', 'underline');
					await expect(tile.locator('.group-caption')).toHaveCSS('text-decoration-line', 'none');
					const underlinedAncestors = await tile.locator('.tile-title').evaluate((node) => {
						const underlined = [];
						for (let parent = node.parentElement; parent; parent = parent.parentElement) {
							if (getComputedStyle(parent).textDecorationLine.includes('underline')) {
								underlined.push(parent.tagName);
							}
						}
						return underlined;
					});
					expect(underlinedAncestors).toEqual([]);
					await expect(image).toHaveCSS('transform', 'none');
					await expect(image).toHaveCSS('filter', 'none');
					await expect(motionSurface).toHaveCSS(
						'filter',
						colorScheme === 'light'
							? 'drop-shadow(rgba(0, 0, 0, 0.24) 0px 6px 10px)'
							: 'drop-shadow(rgba(255, 255, 255, 0.45) 0px 6px 10px)'
					);
					let lift = -2;
					let transform = 'matrix(1, 0, 0, 1, 0, -2)';
					if (reducedMotion === 'reduce') {
						lift = 0;
						transform = 'none';
						await expect(motionSurface).toHaveCSS('transition-duration', '0s');
					} else {
						await expect(motionSurface).toHaveCSS('transition-property', 'transform, filter');
						await expect(motionSurface).toHaveCSS('transition-duration', '0.15s, 0.15s');
					}
					await expect(motionSurface).toHaveCSS('transform', transform);
					expect(await tile.boundingBox()).toEqual(anchorBox);
					const hoveredImage = (await image.boundingBox())!;
					expect(hoveredImage.width).toBe(imageBox.width);
					expect(hoveredImage.height).toBe(imageBox.height);
					expect(hoveredImage.x).toBe(imageBox.x);
					expect(hoveredImage.y).toBeCloseTo(imageBox.y + lift, 2);
				}
			}
		}
	});
}

test('Search distinguishes hover from mouse and keyboard focus without moving controls', async ({
	page
}) => {
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme });
		await page.goto(server.url);
		const search = page.getByRole('searchbox', { name: 'Search', exact: true });
		await expect(search).toBeEnabled();
		const frame = search.locator('..');
		const palette = await fieldPalette(frame);
		const box = await search.boundingBox();
		const frameBox = await frame.boundingBox();
		await search.hover();
		await expect(search).not.toBeFocused();
		await expectBackground(frame, palette.hover);
		await expect(frame).toHaveCSS('border-color', palette.strong);
		await expect(search).toHaveCSS('cursor', 'text');
		await search.click();
		await expect(search).toBeFocused();
		await expectBackground(frame, palette.focus);
		await expectInsetFocus(frame, palette.primary);
		await expect(search).toHaveCSS('outline-style', 'none');
		expect(await search.boundingBox()).toEqual(box);
		expect(await frame.boundingBox()).toEqual(frameBox);
		await search.fill('tag:interactionfixture');
		const clear = page.getByRole('button', { name: 'Clear search', exact: true });
		await expect(clear).toBeVisible();
		const filledBox = await search.boundingBox();
		const theme = page.getByRole('button', { name: 'Switch to dark theme', exact: true });
		for (const button of [clear, theme]) {
			await page.keyboard.press('Tab');
			await expect(button).toBeFocused();
			await expect(button).toHaveCSS('outline-style', 'solid');
			await expect(button).toHaveCSS('outline-width', '2px');
			await expect(button).toHaveCSS('outline-color', palette.primary);
			await expect(button).toHaveCSS('outline-offset', '-2px');
			await expect(frame).toHaveCSS('outline-style', 'none');
		}
		await page.keyboard.press('Shift+Tab');
		await expect(clear).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(search).toBeFocused();
		await expectBackground(frame, palette.focus);
		await expectInsetFocus(frame, palette.primary);
		expect(await search.boundingBox()).toEqual(filledBox);
		expect(await frame.boundingBox()).toEqual(frameBox);
	}
});

test('readonly destination highlights the whole native input wrapper and stays selectable', async ({
	page,
	context
}) => {
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme });
		await page.goto(`${server.url}/?link=archive`);
		const dialog = page.getByRole('dialog');
		const open = dialog.getByRole('link', {
			name: 'Open Reference archive (opens in a new tab)',
			exact: true
		});
		await expect(open).toBeFocused();
		await dialog.evaluate(async (node) => {
			await Promise.all(node.getAnimations().map((animation) => animation.finished));
		});
		const wrapper = dialog.locator('.destination-value');
		const destination = dialog.getByRole('textbox', { name: 'Destination', exact: true });
		await expect(wrapper.locator('img, .ui-input__leading')).toHaveCount(0);
		await expect(destination).toHaveCSS('padding-inline-start', '12px');
		const palette = await fieldPalette(wrapper);
		const wrapperBox = (await wrapper.boundingBox())!;
		const inputBox = (await destination.boundingBox())!;
		await destination.hover({ position: { x: 2, y: inputBox.height / 2 } });
		await expectBackground(wrapper, palette.hover);
		await expect(wrapper).toHaveCSS('border-color', palette.strong);
		await page.keyboard.press('Shift+Tab');
		await expect(destination).toBeFocused();
		await expectBackground(wrapper, palette.focus);
		await expectInsetFocus(wrapper, palette.primary);
		await expect(wrapper).toHaveCSS('border-color', palette.primary);
		await expect(destination).toHaveCSS('outline-style', 'none');
		await expect(destination).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
		expect(await wrapper.boundingBox()).toEqual(wrapperBox);
		expect(await destination.boundingBox()).toEqual(inputBox);
		expect(inputBox.x).toBeGreaterThan(wrapperBox.x);
		expect(inputBox.x + inputBox.width).toBeLessThan(wrapperBox.x + wrapperBox.width);
		await expect(destination).toHaveJSProperty('tagName', 'INPUT');
		await expect(destination).toBeEnabled();
		await expect(destination).toHaveJSProperty('readOnly', true);
		await expect(destination).toHaveValue(serviceURL);
		await page.keyboard.press('ControlOrMeta+A');
		expect(
			await destination.evaluate((node: HTMLInputElement) => [
				node.selectionStart,
				node.selectionEnd
			])
		).toEqual([0, serviceURL.length]);
		await page.keyboard.type('not editable');
		await expect(destination).toHaveValue(serviceURL);
		await expect(open).toHaveAttribute('href', serviceURL);
		await expect(open).toHaveAttribute('target', '_blank');
		await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
		await context.route('https://interaction.example.test/**', (route) =>
			route.fulfill({ contentType: 'text/plain', body: 'Independent service fixture' })
		);
		await page.keyboard.press('Tab');
		await expect(open).toBeFocused();
		const popup = context.waitForEvent('page');
		await page.keyboard.press('Enter');
		const opened = await popup;
		await expect(opened).toHaveURL(serviceURL);
		await opened.close();
		await context.unroute('https://interaction.example.test/**');
	}
});

test('both sign-in credentials use inset focus and a distinct hover in either scheme', async ({
	page
}) => {
	const authenticated = await startServer({
		configuration: configuration + credentialsAuth,
		publicDir
	});
	try {
		await authenticated.ready();
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			await page.goto(`${authenticated.url}/signin`);
			const username = page.getByLabel('Username', { exact: true });
			const password = page.getByLabel('Password', { exact: true });
			await expect(username).toBeFocused();
			await page.keyboard.press('Tab');
			await expect(password).toBeFocused();
			await page.keyboard.press('Tab');
			await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
			for (const input of [password, username]) {
				const frame = input.locator('..');
				const palette = await fieldPalette(frame);
				const box = await input.boundingBox();
				const frameBox = await frame.boundingBox();
				await input.hover();
				await expect(input).not.toBeFocused();
				await expectBackground(frame, palette.hover);
				await expect(frame).toHaveCSS('border-color', palette.strong);
				await page.keyboard.press('Shift+Tab');
				await expect(input).toBeFocused();
				await expectBackground(frame, palette.focus);
				await expectInsetFocus(frame, palette.primary);
				await expect(frame).toHaveCSS('border-color', palette.primary);
				await expect(input).toHaveCSS('outline-style', 'none');
				expect(await input.boundingBox()).toEqual(box);
				expect(await frame.boundingBox()).toEqual(frameBox);
			}
		}
	} finally {
		expect(await authenticated.stop()).toEqual({ code: 0, signal: null });
	}
});

test('disabled Search has no interactive surface before hydration or without JavaScript', async ({
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
		const search = page.getByRole('searchbox', { name: 'Search', exact: true });
		await expect(search).toBeDisabled();
		const frame = search.locator('..');
		const background = await frame.evaluate((node) => getComputedStyle(node).backgroundColor);
		await search.hover();
		await expect(frame).toHaveCSS('background-color', background);
		await expect(frame).toHaveCSS('box-shadow', 'none');
		await expect(frame).toHaveCSS('outline-style', 'none');
		await expect(frame).toHaveCSS('opacity', '0.5');
		await page.keyboard.press('Tab');
		await expect(search).not.toBeFocused();
		await expect(search).not.toHaveCSS('outline-style', 'solid');
		release.resolve();
		await expect(search).toBeEnabled();
	} finally {
		release.resolve();
		await page.unrouteAll({ behavior: 'wait' });
	}
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const plain = await context.newPage();
		await plain.goto(server.url);
		const search = plain.getByRole('searchbox', { name: 'Search', exact: true });
		await expect(search).toBeDisabled();
		const frame = search.locator('..');
		const background = await frame.evaluate((node) => getComputedStyle(node).backgroundColor);
		await search.hover();
		await expect(frame).toHaveCSS('background-color', background);
		await expect(frame).toHaveCSS('box-shadow', 'none');
		await expect(frame).toHaveCSS('outline-style', 'none');
		await expect(frame).toHaveCSS('opacity', '0.5');
		await plain.keyboard.press('Tab');
		await expect(search).not.toBeFocused();
		await expect(search).not.toHaveCSS('outline-style', 'solid');
		await expect(plain.locator('.tile').first()).toBeFocused();
	} finally {
		await context.close();
	}
});
