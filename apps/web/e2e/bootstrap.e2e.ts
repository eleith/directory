import { expect, test } from '@playwright/test';

test('serves the scaffold from the production build', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveTitle('Where — Homelab dashboard');
	await expect(page.getByRole('heading', { name: 'Where' })).toBeVisible();
	await expect(page.getByText("A small directory for your family's homelab.")).toBeVisible();
	await expect(page.getByText('Configuration format 1')).toBeVisible();
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('renders useful initial HTML and serves the local icon', async ({ page, request }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Where' })).toBeVisible();
		await expect(page.getByText("A small directory for your family's homelab.")).toBeVisible();
		await expect(page.getByText('Configuration format 1')).toBeVisible();
		const favicon = await request.get('/favicon.svg');
		expect(favicon.ok()).toBe(true);
		expect(favicon.headers()['content-type']).toContain('image/svg+xml');
	});
});
