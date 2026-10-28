import { expect, test, type Page } from '@playwright/test';
import { navigateQuery } from './support/navigation.js';
import { startServer, type TestServer } from './support/server.js';

const longCopy =
	'Long details with an unbroken token ' + 'word'.repeat(30) + '\n' + 'Instructions.\n'.repeat(90);
const configuration = `site:
  title: Dialog fixture
links:
  alpha:
    title: Alpha service
    url: https://alpha.example.test/path?from=directory
    description: ${JSON.stringify(longCopy)}
  beta:
    title: Beta service
    url: https://beta.example.test/
    description: Short description.
`;
let server: TestServer;

test.beforeAll(async () => {
	server = await startServer({ configuration });
	await server.ready();
});
test.afterAll(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
});

async function hydrated(page: Page) {
	await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeEnabled();
}

async function holdHydration(page: Page) {
	const requested = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	await page.route('**/*.js', async (route) => {
		requested.resolve();
		await release.promise;
		await route.continue();
	});
	return { requested: requested.promise, release: release.resolve };
}

async function finishRendering(page: Page) {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
}

test('direct SSR enhances details once after hydration, without flashing plain details', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const delayed = await holdHydration(page);
	try {
		const response = await page.goto(`${server.url}/?link=alpha`, { waitUntil: 'commit' });
		expect(await response!.text()).toMatch(/<noscript\b/);
		await delayed.requested;
		await finishRendering(page);
		await expect(page.getByRole('region', { name: 'Alpha service', exact: true })).toHaveCount(0);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeDisabled();
		delayed.release();
		await hydrated(page);
		await expect(page.getByRole('dialog', { name: 'Alpha service', exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Alpha service', exact: true })).toHaveCount(1);
		expect(errors).toEqual([]);
	} finally {
		delayed.release();
		await page.unrouteAll({ behavior: 'wait' });
	}
});

test('focus trap, dismissal, history and return focus work together', async ({ page }) => {
	await page.goto(server.url);
	await hydrated(page);
	const tile = page.locator('a[href="/?link=beta"]');
	const close = page.getByRole('button', { name: 'Close', exact: true });
	const external = page.getByRole('link', { name: /^Open Beta service/ });
	const destination = page.getByRole('textbox', { name: 'Destination', exact: true });
	await tile.click();
	await expect(external).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(close).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(destination).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(external).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(destination).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(close).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(external).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(`${server.url}/`);
	await expect(tile).toBeFocused();
	await page.goForward();
	await expect(external).toBeFocused();
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

test('direct close replaces the URL and reload cannot reopen dismissed details', async ({
	page
}) => {
	await page.goto(`${server.url}/?link=beta`);
	await expect(page.getByRole('dialog', { name: 'Beta service' })).toBeVisible();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page).toHaveURL(`${server.url}/`);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
	await page.locator('a[href="/?link=alpha"]').click();
	await expect(page).toHaveURL(`${server.url}/?link=alpha`);
	await page.reload();
	await expect(page.getByRole('dialog', { name: 'Alpha service' })).toBeVisible();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page).toHaveURL(`${server.url}/`);
	await page.reload();
	await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('blocked client boot keeps controls disabled and native grid navigation usable', async ({
	page
}) => {
	await page.route('**/*.js', (route) => route.abort());
	await page.goto(server.url);
	await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeDisabled();
	await expect(page.getByRole('button', { name: /theme/ })).toBeDisabled();
	await page.locator('a[href="/?link=beta"]').click();
	await expect(page).toHaveURL(`${server.url}/?link=beta`);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.locator('a[href="/?link=alpha"]').click();
	await expect(page).toHaveURL(`${server.url}/?link=alpha`);
	await expect(page.locator('.tile')).toHaveCount(2);
});

test('modifier and middle activation preserve native new-tab navigation', async ({
	page,
	context
}) => {
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
		await expect(page.getByRole('dialog')).toHaveCount(0);
	}
});

test('long details keep actions reachable on a narrow screen', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 800 });
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto(`${server.url}/?link=alpha`);
	const dialog = page.getByRole('dialog', { name: 'Alpha service' });
	await expect(dialog).toBeVisible();
	const action = dialog.getByRole('link', { name: /^Open / });
	await action.scrollIntoViewIfNeeded();
	await expect(action).toBeInViewport();
	const close = dialog.getByRole('button', { name: 'Close', exact: true });
	await expect(close).toBeInViewport();
	await close.click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('local details retain their snapshot until native navigation accepts a replacement', async ({
	page
}) => {
	const app = await startServer({ configuration });
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
	} finally {
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});

test('a native snapshot replacement supersedes active details without reopening stale ones', async ({
	page
}) => {
	const app = await startServer({ configuration });
	try {
		await app.ready();
		await page.goto(app.url);
		await hydrated(page);
		await page.locator('a[href="/?link=alpha"]').click();
		await expect(page.getByRole('dialog', { name: 'Alpha service', exact: true })).toBeVisible();
		await app.replace(configuration.replace('Beta service', 'Replacement beta'));
		await expect.poll(async () => (await app.fetch('/')).text()).toContain('Replacement beta');
		await navigateQuery(page, '/?link=beta');
		await expect(page.getByRole('dialog', { name: 'Replacement beta' })).toBeVisible();
		await finishRendering(page);
		await expect(page.getByRole('dialog')).toHaveCount(1);
		await expect(page.getByRole('heading', { name: 'Alpha service', exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page).toHaveURL(`${app.url}/`);
		await expect(page.getByRole('dialog')).toHaveCount(0);
	} finally {
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});

test('closing details preserves the background scroll position', async ({ page }) => {
	const app = await startServer({
		configuration: configuration.replace(
			'title: Dialog fixture',
			`title: Dialog fixture\n  footer: ${JSON.stringify('Footer line.\n'.repeat(80))}`
		)
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

test('Back during pending hydration cannot reopen details afterward', async ({ page }) => {
	const delayed = await holdHydration(page);
	try {
		await page.goto(server.url, { waitUntil: 'commit' });
		await delayed.requested;
		await page.goto(`${server.url}/?link=alpha`, { waitUntil: 'commit' });
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await page.goBack({ waitUntil: 'commit' });
		await expect(page).toHaveURL(`${server.url}/`);
		delayed.release();
		await hydrated(page);
		await finishRendering(page);
		await expect(page.getByRole('dialog')).toHaveCount(0);
	} finally {
		delayed.release();
		await page.unrouteAll({ behavior: 'wait' });
	}
});

for (const cancellation of ['native navigation', 'unmount']) {
	test(`active details stay dismissed after ${cancellation}`, async ({ page }) => {
		await page.goto(server.url);
		await hydrated(page);
		await page.locator('a[href="/?link=alpha"]').click();
		await expect(page.getByRole('dialog')).toBeVisible();
		if (cancellation === 'native navigation') await navigateQuery(page, '/');
		else await navigateQuery(page, '/missing');
		await finishRendering(page);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page).toHaveURL(`${server.url}${cancellation === 'unmount' ? '/missing' : '/'}`);
		if (cancellation === 'unmount') {
			await expect(
				page.getByRole('heading', { name: 'Page not found', exact: true })
			).toBeVisible();
		}
	});
}
