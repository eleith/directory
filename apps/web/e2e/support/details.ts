import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export const clientManifest: Record<string, { file: string }> = JSON.parse(
	readFileSync(
		new URL('../../.svelte-kit/output/client/.vite/manifest.json', import.meta.url),
		'utf8'
	)
);
export const directoryScript =
	'/' + clientManifest['.svelte-kit/generated/client-optimized/nodes/2.js']!.file;

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
