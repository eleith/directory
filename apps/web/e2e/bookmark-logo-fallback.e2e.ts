import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { navigateQuery } from './support/navigation.js';
import { startServer, type TestServer } from './support/server.js';

let directory: string;
let publicDir: string;
let server: TestServer;

function configuration(primary = '/public/primary-a.svg') {
	return `site:
  title: Bookmark logo checks
links:
  broken:
    title: Broken primary
    url: https://broken.example.test
    description: The service is still available.
    tags: [household, photos]
    logo_path: ${primary}
  valid:
    title: Valid primary
    url: https://valid.example.test
    logo_path: /public/valid.svg
  default:
    title: Omitted primary
    url: https://default.example.test
  other:
    title: Other broken primary
    url: https://other.example.test
    logo_path: /public/other.svg
`;
}

const icon =
	'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0f766e"/></svg>';

async function expectDecoded(image: Locator, source: string) {
	await expect(image).toHaveAttribute('src', source);
	await expect
		.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0);
	await image.evaluate((node) => (node as HTMLImageElement).decode());
	await expect(image).toHaveAttribute('alt', '');
	await expect(image).toHaveAttribute('width', '64');
	await expect(image).toHaveAttribute('height', '64');
}

async function expectBroken(image: Locator) {
	await expect(image).toHaveJSProperty('complete', true);
	await expect(image).toHaveJSProperty('naturalWidth', 0);
}

test.setTimeout(60_000);

test.beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'directory-bookmark-logo-e2e-'));
	publicDir = join(directory, 'public');
	try {
		await mkdir(publicDir);
		await writeFile(join(publicDir, 'valid.svg'), icon);
		await writeFile(join(publicDir, 'primary-a.svg'), 'not an image');
		await writeFile(join(publicDir, 'other.svg'), 'not an image');
		server = await startServer({
			configuration: configuration(),
			publicDir
		});
		await server.ready();
	} catch (error) {
		if (server) await server.stop();
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
});

test.afterEach(async () => {
	try {
		if (server) expect(await server.stop()).toEqual({ code: 0, signal: null });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

for (const view of ['card', 'details'] as const) {
	const caption =
		view === 'card'
			? 'a card primary that fails before hydration switches to its decoded fallback'
			: 'direct details defer their image until hydration, then decode the primary’s fallback';
	test(caption, async ({ page }) => {
		const hydration = Promise.withResolvers<void>();
		let heldJavaScript = false;
		await page.route('**/*.js', async (route) => {
			heldJavaScript = true;
			await hydration.promise;
			await route.continue();
		});
		try {
			await page.goto(`${server.url}/${view === 'details' ? '?link=broken' : ''}`, {
				waitUntil: 'commit'
			});
			const cardImage = page
				.getByRole('link', { name: 'Broken primary', exact: true })
				.locator('img');
			await expect(cardImage).toHaveAttribute('src', '/public/primary-a.svg');
			await expectBroken(cardImage);
			await expect.poll(() => heldJavaScript).toBe(true);
			await expect(page.getByRole('dialog')).toHaveCount(0);
			const detailsImage = page.locator('section.details img[width="64"]');
			if (view === 'details') await expect(detailsImage).toHaveCount(0);
			const image = view === 'card' ? cardImage : detailsImage;
			const ssrImage = view === 'card' ? await image.elementHandle() : null;
			try {
				hydration.resolve();
				if (view === 'details') await expect(page.getByRole('dialog')).toBeVisible();
				await expectDecoded(image, '/bookmarks/broken/logo');
				if (view === 'details') {
					const dialog = page.getByRole('dialog');
					await expect(dialog.getByText('The service is still available.')).toBeVisible();
					const destination = dialog.getByRole('link', {
						name: 'Open Broken primary (opens in a new tab)',
						exact: true
					});
					await expect(destination).toBeVisible();
					await expect(destination).toHaveAttribute('href', 'https://broken.example.test');
					await expect(destination).toHaveAttribute('target', '_blank');
					await expect(destination).toHaveAttribute('rel', 'noopener noreferrer');
				}
				if (ssrImage) {
					expect(await image.evaluate((node, previous) => node === previous, ssrImage)).toBe(true);
				}
			} finally {
				await ssrImage?.dispose();
			}
		} finally {
			hydration.resolve();
			await page.unrouteAll({ behavior: 'wait' });
		}
	});
}

test('source changes retry primary URLs in place, including a repaired previously failed URL', async ({
	page
}) => {
	let primaryARequests = 0;
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/public/primary-a.svg') primaryARequests++;
	});
	await page.goto(server.url);
	const image = page.locator('a[href="/?link=broken"] img');
	await expectDecoded(image, '/bookmarks/broken/logo');
	await expect(image).toHaveAttribute('loading', 'lazy');
	await expectDecoded(page.locator('a[href="/?link=valid"] img'), '/public/valid.svg');
	await expectDecoded(page.locator('a[href="/?link=default"] img'), '/bookmarks/default/logo');
	expect(primaryARequests).toBe(1);
	await page.evaluate(() => Reflect.set(window, 'bookmarkNavigationMarker', true));
	const originalImage = await image.elementHandle();
	try {
		await writeFile(join(publicDir, 'primary-b.svg'), icon);
		await server.replace(configuration('/public/primary-b.svg'));
		await expect
			.poll(async () => (await server.fetch('/__data.json')).text())
			.toContain('/public/primary-b.svg');
		await navigateQuery(page, '/?link=valid');
		await expect(page.getByRole('dialog')).toBeVisible();
		await expect(page).toHaveURL(`${server.url}/?link=valid`);
		await expectDecoded(image, '/public/primary-b.svg');

		await writeFile(join(publicDir, 'primary-a.svg'), icon);
		await server.replace(configuration());
		await expect
			.poll(async () => (await server.fetch('/__data.json')).text())
			.toContain('/public/primary-a.svg');
		await navigateQuery(page, '/');
		await expect(page).toHaveURL(`${server.url}/`);
		await expectDecoded(image, '/public/primary-a.svg');
		expect(primaryARequests).toBe(2);

		await writeFile(join(publicDir, 'primary-c.svg'), 'not an image');
		await server.replace(configuration('/public/primary-c.svg'));
		await expect
			.poll(async () => (await server.fetch('/__data.json')).text())
			.toContain('/public/primary-c.svg');
		const primaryResponse = page.waitForResponse(
			(response) => new URL(response.url()).pathname === '/public/primary-c.svg'
		);
		await navigateQuery(page, '/?link=valid');
		await primaryResponse;
		await expectDecoded(image, '/bookmarks/broken/logo');
		expect(await page.evaluate(() => Reflect.get(window, 'bookmarkNavigationMarker'))).toBe(true);
		expect(
			await image.evaluate((node, previous) => node === previous && node.isConnected, originalImage)
		).toBe(true);
	} finally {
		await originalImage?.dispose();
	}
});

test('reused details try each link primary and use that link’s own fallback', async ({ page }) => {
	await page.goto(`${server.url}/?link=broken`);
	await expect(page.getByRole('dialog')).toBeVisible();
	const detailsImage = page.locator('section.details img');
	await expectDecoded(detailsImage, '/bookmarks/broken/logo');
	await expect(detailsImage).not.toHaveAttribute('loading', 'lazy');
	await page.evaluate(() => Reflect.set(window, 'bookmarkNavigationMarker', true));
	const originalImage = await detailsImage.elementHandle();
	try {
		await navigateQuery(page, '/?link=valid');
		await expectDecoded(detailsImage, '/public/valid.svg');
		await navigateQuery(page, '/?link=other');
		await expectDecoded(detailsImage, '/bookmarks/other/logo');
		await navigateQuery(page, '/?link=default');
		await expectDecoded(detailsImage, '/bookmarks/default/logo');
		expect(await page.evaluate(() => Reflect.get(window, 'bookmarkNavigationMarker'))).toBe(true);
		expect(
			await detailsImage.evaluate(
				(node, previous) => node === previous && node.isConnected,
				originalImage
			)
		).toBe(true);
	} finally {
		await originalImage?.dispose();
	}
});

test('failed fallback and default-only images stop after one request', async ({ page }) => {
	const requests = { broken: 0, default: 0 };
	for (const id of ['broken', 'default'] as const) {
		await page.route(`**/bookmarks/${id}/logo`, async (route) => {
			requests[id]++;
			await route.abort();
		});
	}
	const failedFallback = page.waitForEvent(
		'requestfailed',
		(request) => new URL(request.url()).pathname === '/bookmarks/broken/logo'
	);
	const failedDefault = page.waitForEvent(
		'requestfailed',
		(request) => new URL(request.url()).pathname === '/bookmarks/default/logo'
	);
	await page.goto(server.url);
	await Promise.all([failedFallback, failedDefault]);
	for (const id of ['broken', 'default']) {
		const image = page.locator(`a[href="/?link=${id}"] img`);
		await expect(image).toHaveAttribute('src', `/bookmarks/${id}/logo`);
		await expectBroken(image);
	}
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
	expect(requests).toEqual({ broken: 1, default: 1 });
});

test('without JavaScript, good images decode and broken images leave card and detail navigation usable', async ({
	browser
}) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(server.url);
		for (const [id, title] of [
			['broken', 'Broken primary'],
			['valid', 'Valid primary'],
			['default', 'Omitted primary'],
			['other', 'Other broken primary']
		]) {
			const card = page.getByRole('link', { name: title!, exact: true });
			await expect(card).toHaveJSProperty('href', `${server.url}/?link=${id}`);
			await expect(card).toHaveAttribute('data-sveltekit-preload-data', 'false');
		}
		const brokenLink = page.getByRole('link', { name: 'Broken primary', exact: true });
		const broken = brokenLink.locator('img');
		await expect(broken).toHaveAttribute('src', '/public/primary-a.svg');
		await expectBroken(broken);
		await expectDecoded(
			page.getByRole('link', { name: 'Valid primary', exact: true }).locator('img'),
			'/public/valid.svg'
		);
		await expectDecoded(
			page.getByRole('link', { name: 'Omitted primary', exact: true }).locator('img'),
			'/bookmarks/default/logo'
		);
		await brokenLink.click();
		const details = page.getByRole('region', { name: 'Broken primary', exact: true });
		await expect(details.locator('img')).toHaveAttribute('src', '/public/primary-a.svg');
		await expectBroken(details.locator('img'));
		await expect(details.getByText('The service is still available.')).toBeVisible();
		await expect(details.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText([
			'household',
			'photos'
		]);
		const destination = details.getByRole('link', {
			name: 'Open Broken primary (opens in a new tab)',
			exact: true
		});
		await expect(destination).toBeVisible();
		await expect(destination).toHaveAttribute('href', 'https://broken.example.test');
		await expect(destination).toHaveAttribute('target', '_blank');
		await expect(destination).toHaveAttribute('rel', 'noopener noreferrer');
		await expect(destination).toContainText('Open');
		await expect(destination.locator('img')).toHaveCount(0);
		await expect(destination.locator('svg')).toHaveCount(0);
		const url = details.getByRole('textbox', { name: 'Destination', exact: true });
		await expect(url).toBeVisible();
		await expect(url).toHaveValue('https://broken.example.test');
		await expect(url).toHaveJSProperty('readOnly', true);
		await page.getByRole('link', { name: 'Valid primary', exact: true }).click();
		await expectDecoded(page.locator('section.details img'), '/public/valid.svg');
		await page.getByRole('link', { name: 'Omitted primary', exact: true }).click();
		await expectDecoded(page.locator('section.details img'), '/bookmarks/default/logo');
		await page.getByRole('link', { name: 'Back to directory' }).click();
		await expect(page).toHaveURL(`${server.url}/`);
	} finally {
		await context.close();
	}
});
