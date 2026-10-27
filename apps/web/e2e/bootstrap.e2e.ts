import { expect, test } from '@playwright/test';

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('renders useful initial HTML and serves the bundled icon', async ({ page, request }) => {
		await page.goto('/');
		await expect(page).toHaveTitle('Directory');
		await expect(page.getByRole('heading', { name: 'Directory' })).toBeVisible();
		await expect(page.getByText("A small directory for your family's homelab.")).toBeVisible();
		await expect(page.getByText('No bookmarks yet.')).toBeVisible();
		const favicon = await request.get('/favicon.png');
		expect(favicon.ok()).toBe(true);
		expect(favicon.headers()['content-type']).toContain('image/png');
	});
});
