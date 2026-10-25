import { expect, type Page } from '@playwright/test';

export async function navigateQuery(page: Page, href: string) {
	await page.evaluate((destination) => {
		const anchor = document.createElement('a');
		anchor.href = destination;
		anchor.textContent = 'Test native query navigation';
		anchor.id = 'test-native-query';
		(document.querySelector('[role="dialog"]') ?? document.body).append(anchor);
	}, href);
	await page.locator('#test-native-query').click();
	await expect(page).toHaveURL(new URL(href, page.url()).href);
	await page
		.locator('#test-native-query')
		.evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
}
