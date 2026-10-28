import { expect, test, type Page } from '@playwright/test';
import { credentialsAuth, password, username } from './support/configuration.js';
import { navigateQuery } from './support/navigation.js';
import { startServer, type TestServer } from './support/server.js';

const configuration = `site:
  title: Theme fixture
links:
  calendar:
    title: Household calendar
    url: https://calendar.example.test/
`;
let server: TestServer;

test.beforeAll(async () => {
	server = await startServer({ configuration });
	await server.ready();
});

test.afterAll(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
});

async function expectTheme(page: Page, preference: string, applied: 'light' | 'dark') {
	await expect(page.locator('html')).toHaveAttribute('data-theme-preference', preference);
	await expect(page.locator('html')).toHaveAttribute('data-theme', applied);
	await expect(page.locator('html')).toHaveCSS('color-scheme', applied);
}

test('keyboard theme selection follows System, persists, and survives navigation', async ({
	page
}) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto(server.url);
	const toggle = page.getByRole('button', { name: /theme/ });
	await expect(toggle).toBeEnabled();
	await expectTheme(page, 'system', 'light');
	await page.emulateMedia({ colorScheme: 'dark' });
	await expectTheme(page, 'system', 'dark');
	await page.emulateMedia({ colorScheme: 'light' });
	await expectTheme(page, 'system', 'light');

	await page.keyboard.press('Tab');
	await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(toggle).toBeFocused();
	await page.keyboard.press('Enter');
	await expectTheme(page, 'dark', 'dark');
	await page.keyboard.press('Space');
	await expectTheme(page, 'light', 'light');
	await page.keyboard.press('Enter');
	await expectTheme(page, 'system', 'light');
	await toggle.click();
	await page.reload();
	await expect(toggle).toBeEnabled();
	await expectTheme(page, 'dark', 'dark');
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.emulateMedia({ colorScheme: 'light' });
	await expectTheme(page, 'dark', 'dark');

	await navigateQuery(page, '/?q=calendar');
	await expect(page.getByRole('link', { name: 'Household calendar', exact: true })).toBeVisible();
	await expectTheme(page, 'dark', 'dark');
});

test('saved theme applies before hydration and CSP blocks untrusted inline scripts', async ({
	page
}) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.addInitScript(() => localStorage.setItem('directory.theme', 'light'));
	await page.route('**/_app/**/*.js', (route) => route.abort());
	const response = await page.goto(server.url);
	const policy = response!.headers()['content-security-policy'];
	expect(policy).toContain("object-src 'none'");
	expect(policy).toContain("frame-ancestors 'none'");
	await expectTheme(page, 'light', 'light');
	await expect(page.getByRole('button', { name: /theme/ })).toBeDisabled();
	await page.evaluate(() => {
		const script = document.createElement('script');
		script.textContent = 'document.documentElement.dataset.untrustedScript = "ran"';
		document.head.append(script);
	});
	await expect(page.locator('html')).not.toHaveAttribute('data-untrusted-script');
});

test('unavailable storage leaves theme selection usable', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.addInitScript(() => {
		for (const method of ['getItem', 'setItem'] as const) {
			Storage.prototype[method] = () => {
				throw new DOMException('Blocked', 'SecurityError');
			};
		}
	});
	await page.goto(server.url);
	const toggle = page.getByRole('button', { name: /theme/ });
	await expect(toggle).toBeEnabled();
	await expectTheme(page, 'system', 'light');
	await toggle.click();
	await expectTheme(page, 'dark', 'dark');
	await toggle.click();
	await expectTheme(page, 'light', 'light');
	await toggle.click();
	await page.emulateMedia({ colorScheme: 'dark' });
	await expectTheme(page, 'system', 'dark');
});

test('saved theme survives sign-in and sign-out', async ({ page }) => {
	const app = await startServer({ configuration: configuration + credentialsAuth });
	try {
		await app.ready();
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto(app.url);
		await expect(page).toHaveURL((url) => url.pathname === '/signin');
		await page.evaluate(() => localStorage.setItem('directory.theme', 'dark'));
		await page.reload();
		await expectTheme(page, 'dark', 'dark');
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
		await expectTheme(page, 'dark', 'dark');
		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page).toHaveURL((url) => url.pathname === '/signin');
		await expectTheme(page, 'dark', 'dark');
	} finally {
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});
