import { expect, test } from '@playwright/test';
import { credentialsAuth, password, username } from './support/configuration.js';
import { startServer } from './support/server.js';

const title = 'Family directory';
const description = 'Things running at home.';

function configuration(auth = '') {
	return `site:
  title: ${title}
  description: ${description}
  footer: Ask your household maintainer.
links:
  photos:
    title: Photos
    url: https://photos.example.test
    description: |
      Store your originals.
      Keep shared albums together.
    tags: photos, backup
    group: Media
  router:
    title: Router
    url: http://router.example.test
    group: Behind the scenes
    requires_auth: true
    internal_only: true
    admin_only: true
  notes:
    title: Household notes
    url: https://notes.example.test
${auth}`;
}

test('groups, bookmark titles and plain details work without JavaScript', async ({ browser }) => {
	const server = await startServer({ configuration: configuration(), secret: null, origin: null });
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		await server.ready();
		const page = await context.newPage();
		await page.goto(server.url);
		await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
		for (const name of ['Media', 'Behind the scenes', 'Other']) {
			await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
		}
		for (const [id, label] of [
			['photos', 'Photos'],
			['router', 'Router'],
			['notes', 'Household notes']
		]) {
			const link = page.locator(`a[href="/?link=${id}"]`);
			await expect(link).toContainText(label!);
			await expect(link).toHaveAttribute('data-sveltekit-preload-data', 'off');
		}
		await expect(page.locator('a[href="/?link=photos"] img')).toHaveAttribute(
			'src',
			'/bookmarks/photos/logo'
		);
		await page.locator('a[href="/?link=photos"]').click();
		await expect(page).toHaveURL(`${server.url}/?link=photos`);
		await expect(page.getByRole('heading', { name: 'Photos', exact: true })).toBeVisible();
		await expect(page.getByText('Store your originals.', { exact: false })).toBeVisible();
		await expect(page.getByText('Keep shared albums together.', { exact: false })).toBeVisible();
		await expect(page.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText([
			'photos',
			'backup'
		]);
		await expect(page.getByRole('list', { name: 'Service information' })).toHaveCount(0);
		const destination = page.locator('a[href="https://photos.example.test"]');
		await expect(destination).toHaveAttribute('target', '_blank');
		await expect(destination).toHaveAttribute('rel', 'noopener noreferrer');
		await expect(destination).toHaveAccessibleName(/opens in a new tab/i);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await page.getByRole('link', { name: 'Back to directory' }).click();
		await expect(page).toHaveURL(`${server.url}/`);
		await page.goto(`${server.url}/?link=router`);
		const tags = page.getByRole('list', { name: 'Tags' });
		await expect(tags).toHaveCount(1);
		await expect(tags.getByRole('listitem')).toHaveText(['login', 'internal', 'admin']);
		await expect(tags.getByRole('listitem').last()).toHaveAccessibleName('admin only');
		await expect(page.locator('a[href="/?link=photos"]')).toBeVisible();
	} finally {
		await context.close();
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('actual bookmark HTML and Kit data remain private until sign-in', async ({ page }) => {
	const server = await startServer({ configuration: configuration(credentialsAuth) });
	try {
		await server.ready();
		const anonymous = await server.fetch('/signin');
		const publicHtml = await anonymous.text();
		for (const value of [
			description,
			'photos.example.test',
			'Store your originals.',
			username,
			password
		]) {
			expect(publicHtml).not.toContain(value);
		}
		expect((await server.fetch('/__data.json')).status).toBe(401);
		await page.goto(server.url);
		await expect(page).toHaveURL(`${server.url}/signin?callbackUrl=%2F`);
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.locator('a[href="/?link=photos"]')).toBeVisible();
		const data = await page.request.get(`${server.url}/__data.json`);
		expect(data.status()).toBe(200);
		const payload = await data.text();
		expect(payload).toContain('photos.example.test');
		for (const value of [username, password, server.secret!, server.path])
			expect(payload).not.toContain(value);
		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page).toHaveURL(/\/signin/);
		expect(
			(await page.request.get(`${server.url}/__data.json`, { maxRedirects: 0 })).status()
		).toBe(401);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('flat and empty directories, invalid selections and phone-width text stay usable', async ({
	page
}) => {
	const flat = configuration()
		.replaceAll('    group: Media\n', '')
		.replaceAll('    group: Behind the scenes\n', '');
	const server = await startServer({ configuration: flat, secret: null, origin: null });
	try {
		await server.ready();
		await page.setViewportSize({ width: 360, height: 900 });
		await page.goto(server.url);
		await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
		await expect(page.locator('a[href^="/?link="]')).toHaveCount(3);
		for (const query of [
			'?link=missing',
			'?link=',
			'?link=photos&link=router',
			'?link=constructor'
		]) {
			expect((await server.fetch(`/${query}`)).status).toBe(404);
		}
		const literal = '<img src=x onerror="window.PRIVATE_UI_XSS=1">';
		await server.replace(flat.replace('title: Photos', `title: ${JSON.stringify(literal)}`));
		await expect.poll(async () => (await server.fetch('/')).text()).toContain('&lt;img');
		await page.goto(`${server.url}/?link=photos`);
		await expect(page.getByRole('heading', { name: literal, exact: true })).toBeVisible();
		expect(await page.evaluate(() => 'PRIVATE_UI_XSS' in window)).toBe(false);
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
			).toBe(true);
		}
		await server.replace(`site:\n  title: ${title}\nlinks: {}\n`);
		await expect.poll(async () => (await server.fetch('/')).text()).toContain('No bookmarks yet.');
		await page.goto(server.url);
		await expect(page.getByText('No bookmarks yet.')).toBeVisible();
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});
