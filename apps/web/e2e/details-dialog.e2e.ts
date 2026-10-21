import { expect, test, type Page, type Request } from '@playwright/test';
import { dialogScript, eagerClientFiles, navigateQuery } from './support/details.js';
import { startServer, type TestServer } from './support/server.js';

const longCopy =
	'Long details with an unbroken token ' + 'word'.repeat(30) + '\n' + 'Instructions.\n'.repeat(90);
const configuration = `site:
  title: Dialog fixture
appearance:
  primary_light_color: '#13579b'
  primary_dark_color: '#e2c4a6'
links:
  alpha:
    title: Alpha service
    url: https://alpha.example.test/path?from=directory
    group: Household
    description: ${JSON.stringify(longCopy)}
    tags: photos, backup
    requires_auth: true
    internal_only: true
    admin_only: true
  beta:
    title: Beta service
    url: https://beta.example.test/
    description: Short description.
`;
let server: TestServer;

test.beforeAll(async () => {
	server = await startServer({ configuration, secret: null, origin: null });
	await server.ready();
});
test.afterAll(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
});

async function hydrated(page: Page) {
	await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeEnabled();
	await expect(
		page.getByRole('button', { name: 'Switch to dark theme', exact: true })
	).toBeEnabled();
}

async function holdDialog(page: Page) {
	const requested = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const settled = Promise.withResolvers<void>();
	function markSettled(request: Request) {
		if (request.url().endsWith(dialogScript)) settled.resolve();
	}
	page.on('requestfinished', markSettled);
	page.on('requestfailed', markSettled);
	await page.route(`**${dialogScript}`, async (route) => {
		requested.resolve();
		await release.promise;
		await route.continue();
	});
	return { requested: requested.promise, settled: settled.promise, release: release.resolve };
}

test('direct SSR and first hydration retain the plain section until the delayed dialog is ready', async ({
	page
}) => {
	const scripts = Promise.withResolvers<void>();
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (/hydration/i.test(message.text())) errors.push(message.text());
	});
	await page.route('**/_app/**/*.js', async (route) => {
		if (!route.request().url().endsWith(dialogScript)) await scripts.promise;
		await route.continue();
	});
	const delayed = await holdDialog(page);
	try {
		const response = await page.goto(`${server.url}/?link=alpha`, { waitUntil: 'commit' });
		const html = await response!.text();
		expect(html).toContain('Back to directory');
		expect(html).not.toContain('role="dialog"');
		const section = page.getByRole('region', { name: 'Alpha service', exact: true });
		await expect(section).toBeVisible();
		await expect(page.locator('.tile')).toHaveCount(2);
		const baseline = await section.elementHandle();
		scripts.resolve();
		await hydrated(page);
		await delayed.requested;
		expect(await section.evaluate((node, previous) => node === previous, baseline)).toBe(true);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		delayed.release();
		await expect(page.getByRole('dialog', { name: 'Alpha service', exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Alpha service', exact: true })).toHaveCount(1);
		await expect(page.getByRole('link', { name: 'Back to directory' })).toHaveCount(0);
		await expect(page.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText([
			'photos',
			'backup'
		]);
		await expect(
			page.getByRole('list', { name: 'Service information' }).getByRole('listitem')
		).toHaveText(['Requires authentication', 'Internal only', 'Admin only']);
		const external = page.getByRole('link', {
			name: 'Open service (opens in a new tab)',
			exact: true
		});
		await expect(external).toHaveAttribute(
			'href',
			'https://alpha.example.test/path?from=directory'
		);
		await expect(external).toHaveAttribute('target', '_blank');
		await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
		expect(errors).toEqual([]);
	} finally {
		scripts.resolve();
		delayed.release();
		await page.unrouteAll({ behavior: 'wait' });
	}
});

test('grid has no eager dialog imports or speculative requests; activation reuses one chunk and loaded snapshot', async ({
	page
}) => {
	const requested: string[] = [];
	page.on('request', (request) => requested.push(new URL(request.url()).pathname));
	expect(eagerClientFiles.has(dialogScript.slice(1))).toBe(false);
	await page.goto(server.url);
	await hydrated(page);
	const tile = page.locator('a[href="/?link=alpha"]');
	await tile.hover();
	await tile.focus();
	await expect(tile).toHaveAttribute('data-sveltekit-preload-data', 'off');
	expect(requested).not.toContain(dialogScript);
	const before = requested.length;
	await tile.click();
	await expect(page.getByRole('dialog', { name: 'Alpha service' })).toBeVisible();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page).toHaveURL(`${server.url}/`);
	await page.locator('a[href="/?link=beta"]').click();
	await expect(page.getByRole('dialog', { name: 'Beta service' })).toBeVisible();
	expect(requested.filter((path) => path === dialogScript)).toHaveLength(1);
	expect(
		requested.slice(before).filter((path) => path.includes('__data.json') || path === '/')
	).toEqual([]);
});

test('controlled focus trap, Escape, outside dismissal, close, history and return focus', async ({
	page
}) => {
	await page.goto(server.url);
	await hydrated(page);
	const tile = page.locator('a[href="/?link=beta"]');
	const close = page.getByRole('button', { name: 'Close', exact: true });
	const external = page.getByRole('link', {
		name: 'Open service (opens in a new tab)',
		exact: true
	});
	await tile.click();
	await expect(close).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(external).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(close).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(external).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(`${server.url}/`);
	await expect(tile).toBeFocused();
	await page.goForward();
	await expect(close).toBeFocused();
	await page.goBack();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(tile).toBeFocused();
	await page.goForward();
	await expect(close).toBeVisible();
	await page.locator('[data-dialog-overlay]').click({ position: { x: 5, y: 5 } });
	await expect(page).toHaveURL(`${server.url}/`);
	await expect(tile).toBeFocused();
	await tile.click();
	await close.click();
	await expect(page).toHaveURL(`${server.url}/`);
	await expect(tile).toBeFocused();
});

test('direct close safely replaces the URL, keeps the baseline dismissed, and reload uses real detail URLs', async ({
	page
}) => {
	await page.goto(`${server.url}/?link=beta`);
	await expect(page.getByRole('dialog', { name: 'Beta service' })).toBeVisible();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page).toHaveURL(`${server.url}/`);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.locator('section.details')).toHaveCount(0);
	await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
	await page.locator('a[href="/?link=alpha"]').click();
	await expect(page).toHaveURL(`${server.url}/?link=alpha`);
	await page.reload();
	await expect(page.getByRole('dialog', { name: 'Alpha service' })).toBeVisible();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page).toHaveURL(`${server.url}/`);
	await expect(page.locator('section.details')).toHaveCount(0);
	await page.reload();
	await expect(page.locator('section.details')).toHaveCount(0);
});

for (const entry of ['grid', 'direct']) {
	test(`failed chunk: ${entry} uses only its safe SSR fallback`, async ({ page }) => {
		let documents = 0;
		let chunks = 0;
		page.on('request', (request) => {
			if (request.isNavigationRequest()) documents++;
		});
		await page.route(`**${dialogScript}`, (route) => {
			chunks++;
			return route.abort();
		});
		await page.goto(`${server.url}/${entry === 'direct' ? '?link=beta' : ''}`);
		await hydrated(page);
		if (entry === 'grid') await page.locator('a[href="/?link=beta"]').click();
		await expect(page.getByRole('region', { name: 'Beta service', exact: true })).toBeVisible();
		await hydrated(page);
		await expect.poll(() => chunks).toBe(entry === 'grid' ? 2 : 1);
		await page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
				)
		);
		expect(documents).toBe(entry === 'grid' ? 2 : 1);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Back to directory' })).toHaveAttribute(
			'href',
			'/'
		);
	});
}

test('modifier and middle activation preserve real new-tab navigation without enhancing the original grid', async ({
	page,
	context
}) => {
	const chunks: string[] = [];
	page.on('request', (request) => {
		if (request.url().endsWith(dialogScript)) chunks.push(request.url());
	});
	await page.goto(server.url);
	await hydrated(page);
	for (const options of [
		{ modifiers: ['Control'] as ['Control'] },
		{ button: 'middle' as const }
	]) {
		const popup = context.waitForEvent('page');
		await page.locator('a[href="/?link=beta"]').click(options);
		const opened = await popup;
		await expect(opened).toHaveURL(`${server.url}/?link=beta`);
		await opened.close();
		await expect(page).toHaveURL(`${server.url}/`);
	}
	expect(chunks).toEqual([]);
});

for (const width of [360, 1280]) {
	test(`When-style entrance motion and reduced-motion preference: ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 800 });
		for (const reducedMotion of ['no-preference', 'reduce'] as const) {
			await page.emulateMedia({ reducedMotion });
			await page.goto(server.url);
			await hydrated(page);
			await page.locator('a[href="/?link=beta"]').click();
			const dialog = page.getByRole('dialog', { name: 'Beta service', exact: true });
			const overlay = page.locator('[data-dialog-overlay]');
			await expect(dialog).toBeVisible();
			if (reducedMotion === 'reduce') {
				await expect(overlay).toHaveCSS('animation-name', 'none');
				await expect(dialog).toHaveCSS('animation-name', 'none');
			} else {
				await expect(overlay).toHaveCSS('animation-name', /backdrop-fade-in$/);
				await expect(overlay).toHaveCSS('animation-duration', '0.15s');
				await expect(overlay).toHaveCSS('animation-timing-function', 'ease-out');
				if (width === 360) {
					await expect(dialog).toHaveCSS('animation-name', /sheet-slide-up$/);
					await expect(dialog).toHaveCSS('animation-duration', '0.2s');
					await expect(dialog).toHaveCSS('animation-timing-function', 'ease-out');
				} else {
					await expect(dialog).toHaveCSS('animation-name', 'none');
				}
			}
			await dialog.evaluate((node) =>
				Promise.all(node.getAnimations().map((animation) => animation.finished))
			);
			await expect(overlay).toHaveCSS('opacity', '1');
			const box = (await dialog.boundingBox())!;
			if (width === 360) expect(box.y + box.height).toBeCloseTo(800, 0);
			else expect(box.y + box.height / 2).toBeCloseTo(400, 0);
			await page.keyboard.press('Escape');
			await expect(page.getByRole('dialog')).toHaveCount(0);
			await expect(page.locator('a[href="/?link=beta"]')).toBeFocused();
		}
	});

	for (const colorScheme of ['light', 'dark'] as const) {
		test(`responsive sheet, internal scrolling, scroll lock and protected accent: ${width} ${colorScheme}`, async ({
			page
		}) => {
			await page.setViewportSize({ width, height: 800 });
			await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
			await page.goto(`${server.url}/?link=alpha`);
			const dialog = page.getByRole('dialog', { name: 'Alpha service' });
			await expect(dialog).toBeVisible();
			const close = dialog.getByRole('button', { name: 'Close', exact: true });
			await expect(close).toBeFocused();
			await expect(close).toHaveCSS(
				'outline-color',
				colorScheme === 'light' ? 'rgb(19, 87, 155)' : 'rgb(226, 196, 166)'
			);
			expect(await dialog.evaluate((node) => node.closest('.directory-theme') !== null)).toBe(true);
			const box = (await dialog.boundingBox())!;
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(width);
			expect(box.height).toBeLessThanOrEqual(800);
			if (width === 360) expect(box.y + box.height).toBeCloseTo(800, 0);
			else expect(box.x + box.width / 2).toBeCloseTo(width / 2, 0);
			const closeBox = (await close.boundingBox())!;
			expect(closeBox.width).toBeGreaterThanOrEqual(44);
			expect(closeBox.height).toBeGreaterThanOrEqual(44);
			await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
			const scroll = dialog.locator('.scroll-content');
			expect(await scroll.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
			await scroll.evaluate((node) => {
				node.scrollTop = node.scrollHeight;
			});
			await expect(dialog.getByRole('link', { name: /Open service/ })).toBeInViewport();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true
			);
			await close.click();
			await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
		});
	}
}

test('local details keep the loaded snapshot until real native navigation accepts a replacement', async ({
	page
}) => {
	const app = await startServer({ configuration, secret: null, origin: null });
	try {
		await app.ready();
		await page.goto(app.url);
		await hydrated(page);
		const documentRequests: string[] = [];
		page.on('request', (request) => {
			if (request.isNavigationRequest() || request.url().includes('__data.json')) {
				documentRequests.push(request.url());
			}
		});
		await app.replace(configuration.replace('Alpha service', 'Replacement alpha'));
		await expect.poll(async () => (await app.fetch('/')).text()).toContain('Replacement alpha');
		await page.locator('a[href="/?link=alpha"]').click();
		await expect(page.getByRole('dialog', { name: 'Alpha service', exact: true })).toBeVisible();
		expect(documentRequests).toEqual([]);
		await navigateQuery(page, '/?link=beta');
		await expect(page.getByRole('dialog', { name: 'Beta service', exact: true })).toBeVisible();
		await navigateQuery(page, '/?link=alpha');
		await expect(
			page.getByRole('dialog', { name: 'Replacement alpha', exact: true })
		).toBeVisible();
		expect(documentRequests.filter((url) => url.includes('__data.json'))).toHaveLength(2);
	} finally {
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});

test('a native snapshot replacement cancels the earlier delayed tile intent', async ({ page }) => {
	const app = await startServer({ configuration, secret: null, origin: null });
	const delayed = await holdDialog(page);
	try {
		await app.ready();
		await page.goto(app.url);
		await hydrated(page);
		await page.locator('a[href="/?link=alpha"]').click();
		await delayed.requested;
		await app.replace(configuration.replace('Beta service', 'Replacement beta'));
		await expect.poll(async () => (await app.fetch('/')).text()).toContain('Replacement beta');
		await navigateQuery(page, '/?link=beta');
		await expect(page.getByRole('region', { name: 'Replacement beta' })).toBeVisible();
		delayed.release();
		await expect(page.getByRole('dialog', { name: 'Replacement beta' })).toBeVisible();
		await expect(page).toHaveURL(`${app.url}/?link=beta`);
		await page.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page).toHaveURL(`${app.url}/`);
		await expect(page.locator('section.details')).toHaveCount(0);
	} finally {
		delayed.release();
		await page.unrouteAll({ behavior: 'wait' });
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});

test('dialog scroll lock and close preserve the grid scroll position', async ({ page }) => {
	const app = await startServer({
		configuration: configuration.replace(
			'title: Dialog fixture',
			`title: Dialog fixture\n  footer: ${JSON.stringify('Footer line.\n'.repeat(80))}`
		),
		secret: null,
		origin: null
	});
	try {
		await app.ready();
		await page.setViewportSize({ width: 360, height: 400 });
		await page.goto(app.url);
		await hydrated(page);
		await page.evaluate(() => scrollTo(0, 100));
		await page.locator('a[href="/?link=beta"]').click();
		await expect(page.getByRole('dialog')).toBeVisible();
		const position = await page.evaluate(() => scrollY);
		expect(position).toBeGreaterThan(0);
		await page.mouse.move(2, 2);
		await page.mouse.wheel(0, 300);
		await expect.poll(() => page.evaluate(() => scrollY)).toBe(position);
		await page.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect.poll(() => page.evaluate(() => scrollY)).toBe(position);
	} finally {
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});

test('a disconnected tile returns focus to the directory heading', async ({ page }) => {
	await page.goto(server.url);
	await hydrated(page);
	const tile = page.locator('a[href="/?link=beta"]');
	await tile.click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await tile.evaluate((node) => node.remove());
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});

for (const dismissal of ['Close', 'Escape', 'outside']) {
	test(`delayed direct details remain controlled after opening another tile and ${dismissal}`, async ({
		page
	}) => {
		const delayed = await holdDialog(page);
		try {
			await page.goto(`${server.url}/?link=alpha`);
			await hydrated(page);
			await delayed.requested;
			await page.locator('a[href="/?link=beta"]').click();
			delayed.release();
			await expect(page.getByRole('dialog', { name: 'Beta service' })).toBeVisible();
			if (dismissal === 'Close') {
				await page.getByRole('button', { name: 'Close', exact: true }).click();
			} else if (dismissal === 'Escape') {
				await page.keyboard.press('Escape');
			} else {
				await page.locator('[data-dialog-overlay]').click({ position: { x: 5, y: 5 } });
			}
			await expect(page).toHaveURL(`${server.url}/?link=alpha`);
			await expect(page.getByRole('dialog', { name: 'Alpha service' })).toBeVisible();
			await page.getByRole('button', { name: 'Close', exact: true }).click();
			await expect(page).toHaveURL(`${server.url}/`);
			await expect(page.getByRole('dialog')).toHaveCount(0);
			await page.locator('a[href="/?link=beta"]').click();
			await expect(page.getByRole('dialog', { name: 'Beta service' })).toBeVisible();
		} finally {
			delayed.release();
			await page.unrouteAll({ behavior: 'wait' });
		}
	});
}

test('rapid A then B activation accepts only the latest delayed intent', async ({ page }) => {
	const delayed = await holdDialog(page);
	try {
		await page.goto(server.url);
		await hydrated(page);
		await page.locator('a[href="/?link=alpha"]').click();
		await delayed.requested;
		await page.locator('a[href="/?link=beta"]').click();
		delayed.release();
		await expect(page.getByRole('dialog', { name: 'Beta service' })).toBeVisible();
		await expect(page).toHaveURL(`${server.url}/?link=beta`);
		await page.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page).toHaveURL(`${server.url}/`);
	} finally {
		delayed.release();
		await page.unrouteAll({ behavior: 'wait' });
	}
});

for (const cancellation of ['back', 'baseline Back', 'native navigation', 'unmount']) {
	test(`delayed enhancement cannot reopen after ${cancellation}`, async ({ page }) => {
		const delayed = await holdDialog(page);
		try {
			await page.goto(server.url);
			await hydrated(page);
			if (cancellation === 'back' || cancellation === 'baseline Back')
				await navigateQuery(page, '/?link=alpha');
			else await page.locator('a[href="/?link=alpha"]').click();
			await delayed.requested;
			if (cancellation === 'back') await page.goBack();
			if (cancellation === 'baseline Back')
				await page.getByRole('link', { name: 'Back to directory' }).click();
			if (cancellation === 'native navigation') await navigateQuery(page, '/');
			if (cancellation === 'unmount') await navigateQuery(page, '/missing');
			delayed.release();
			await delayed.settled;
			await page.unrouteAll({ behavior: 'wait' });
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
					)
			);
			await expect(page.getByRole('dialog')).toHaveCount(0);
			await expect(page).toHaveURL(`${server.url}${cancellation === 'unmount' ? '/missing' : '/'}`);
		} finally {
			delayed.release();
			await page.unrouteAll({ behavior: 'wait' });
		}
	});
}
