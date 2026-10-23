import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export const clientManifest: Record<
	string,
	{ file: string; imports?: string[]; dynamicImports?: string[] }
> = JSON.parse(
	readFileSync(
		new URL('../../.svelte-kit/output/client/.vite/manifest.json', import.meta.url),
		'utf8'
	)
);
export const directoryScript =
	'/' + clientManifest['.svelte-kit/generated/client-optimized/nodes/2.js']!.file;

export function staticClientFiles(entryKeys: readonly string[]) {
	const files = new Set<string>();
	function visit(key: string) {
		const entry = clientManifest[key]!;
		if (files.has(entry.file)) return;
		files.add(entry.file);
		for (const dependency of entry.imports ?? []) visit(dependency);
	}
	for (const key of entryKeys) visit(key);
	return files;
}

export const eagerClientFiles = staticClientFiles(
	Object.keys(clientManifest).filter(
		(key) => key.includes('/nodes/') || key.includes('/entry.js') || key.endsWith('/app.js')
	)
);

// Exercise native Kit query updates, not the tile's shallow-dialog action.
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
