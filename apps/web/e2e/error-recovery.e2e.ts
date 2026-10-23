import { expect, test } from '@playwright/test';
import {
	configuration,
	password,
	privateSentinels,
	siteTitle,
	username
} from './support/configuration.js';
import { startServer } from './support/server.js';

for (const javaScriptEnabled of [true, false]) {
	for (const colorScheme of ['light', 'dark'] as const) {
		test(`missing pages and bookmarks have native recovery (JavaScript=${javaScriptEnabled}, ${colorScheme})`, async ({
			browser
		}) => {
			let width = 1280;
			if (colorScheme === 'dark') width = 390;
			const context = await browser.newContext({
				javaScriptEnabled,
				colorScheme,
				viewport: { width, height: 800 }
			});
			const server = await startServer({ configuration: configuration('') });
			try {
				await server.ready();
				const page = await context.newPage();
				for (const path of [
					'/missing-page?message=UNTRUSTED_ERROR_COPY',
					'/?link=missing',
					'/?link=household&link=administration'
				]) {
					const response = await page.goto(server.url + path);
					expect(response?.status()).toBe(404);
					await expect(page).toHaveTitle('Error 404');
					await expect(
						page.getByRole('heading', { name: 'Page not found', exact: true })
					).toBeVisible();
					await expect(page.getByText('404', { exact: true })).toBeVisible();
					await expect(page.locator('main > p')).toHaveCount(1);
					await expect(page.locator('main')).not.toContainText(/directory/i);
					const recovery = page.getByRole('link', { name: 'Back to home', exact: true });
					await expect(recovery).toHaveAttribute('href', '/');
					await expect(recovery).toHaveAttribute('data-sveltekit-reload', 'true');
					const statusBounds = await page.getByText('404', { exact: true }).boundingBox();
					const headingBounds = await page
						.getByRole('heading', { name: 'Page not found', exact: true })
						.boundingBox();
					const bounds = await recovery.boundingBox();
					const viewport = page.viewportSize()!;
					for (const element of [statusBounds!, headingBounds!, bounds!]) {
						expect(
							Math.abs(element.x + element.width / 2 - viewport.width / 2)
						).toBeLessThanOrEqual(1);
					}
					const contentCenter = (statusBounds!.y + bounds!.y + bounds!.height) / 2;
					expect(Math.abs(contentCenter - viewport.height / 2)).toBeLessThanOrEqual(1);
					expect(bounds!.height).toBeGreaterThanOrEqual(48);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
					).toBe(true);
					for (const value of [...privateSentinels, 'UNTRUSTED_ERROR_COPY']) {
						await expect(page.locator('main')).not.toContainText(value);
					}
					await page.keyboard.press('Tab');
					await expect(recovery).toBeFocused();
					await expect(recovery).toHaveCSS('outline-style', 'solid');
					await expect(recovery).toHaveCSS('outline-width', '2px');
					await page.keyboard.press('Enter');
					await expect(page).toHaveURL(`${server.url}/`);
					await expect(page.getByRole('heading', { name: siteTitle, exact: true })).toBeVisible();
				}
			} finally {
				await context.close();
				await server.stop();
			}
		});
	}
}

test('recovery preserves authentication and does not replace private API denials', async ({
	browser
}) => {
	const server = await startServer({ configuration: configuration() });
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		await server.ready();
		const denied = await server.fetch('/unknown', { headers: { accept: 'application/json' } });
		expect(denied.status).toBe(401);
		expect(await denied.text()).toBe('Access denied');
		const navigation = await server.fetch('/unknown', { headers: { accept: 'text/html' } });
		expect(navigation.status).toBe(303);
		expect(new URL(navigation.headers.get('location')!, server.url).pathname).toBe('/signin');
		const page = await context.newPage();
		await page.goto(`${server.url}/signin`);
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
		const response = await page.goto(`${server.url}/?link=missing`);
		expect(response?.status()).toBe(404);
		await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();
		const html = await page.content();
		for (const value of [...privateSentinels, server.secret!, server.path])
			expect(html).not.toContain(value);
		await page.getByRole('link', { name: 'Back to home', exact: true }).click();
		await expect(page).toHaveURL(`${server.url}/`);
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
	} finally {
		await context.close();
		await server.stop();
	}
});
