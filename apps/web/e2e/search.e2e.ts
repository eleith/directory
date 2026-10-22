import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Request } from '@playwright/test';
import {
	clientManifest,
	dialogScript,
	eagerClientFiles,
	navigateQuery,
	staticClientFiles
} from './support/details.js';
import { credentialsAuth, password, username } from './support/configuration.js';
import { startServer, type TestServer } from './support/server.js';

import { watchSearchStability } from './support/search-stability.js';

const engineKey = 'src/lib/search/engine.ts';
const engineScript = '/' + clientManifest[engineKey]!.file;
const engineFiles = staticClientFiles([engineKey]);
const longTerms = 'copper lantern telescope meadow archive orchard constellation';
const configuration = `site:
  title: Search fixture
  description: Private household directory
appearance:
  primary_light_color: '#13579b'
  primary_dark_color: '#e2c4a6'
links:
  immich:
    title: Immich
    url: https://photos.example.test/
    group: Media
    tags: ' , backup, , snapshots, '
    description: Photos for the family
    requires_auth: true
  navidrome:
    title: Navidrome
    url: https://music.example.test/listening
    group: Media
    internal_only: true
  jellyfin:
    title: Jellyfin
    url: https://video.example.test/
    group: Media
  description:
    title: Notes
    url: https://notes.example.test/
    group: Records
    description: amberquartz
  tag:
    title: Documents
    url: https://documents.example.test/
    group: Records
    tags: amberquartz
  title:
    title: amberquartz
    url: https://reference.example.test/
    group: Records
  slug-observatory:
    title: Weather
    url: https://climate.example.test/pressure
    group: amberquartz
    admin_only: true
  ungrouped:
    title: Calendar
    url: https://calendar.example.test/
    description: ${JSON.stringify('Ordinary instructions.\n'.repeat(100) + longTerms)}
`;
const originalTitles = [
	'Immich',
	'Navidrome',
	'Jellyfin',
	'Notes',
	'Documents',
	'amberquartz',
	'Weather',
	'Calendar'
];
const groupLabels = ['Media', 'Records', 'amberquartz', 'Other'];
let server: TestServer;

test.beforeAll(async () => {
	server = await startServer({ configuration, secret: null, origin: null });
	await server.ready();
});
test.afterAll(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
});

function searchInput(page: Page) {
	return page.getByRole('searchbox', { name: 'Search', exact: true });
}

async function openGrid(page: Page, url = server.url) {
	await page.goto(url);
	await expect(searchInput(page)).toBeEnabled();
}

async function expectTitles(page: Page, titles: string[]) {
	await expect(page.locator('.tile > span')).toHaveText(titles);
}

async function holdChunk(page: Page, script: string) {
	const requested = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const settled = Promise.withResolvers<void>();
	function markSettled(request: Request) {
		if (request.url().endsWith(script)) settled.resolve();
	}
	page.on('requestfinished', markSettled);
	page.on('requestfailed', markSettled);
	await page.route(`**${script}`, async (route) => {
		requested.resolve();
		await release.promise;
		await route.continue();
	});
	return { requested: requested.promise, release: release.resolve, settled: settled.promise };
}

function holdEngine(page: Page) {
	return holdChunk(page, engineScript);
}

async function finishRendering(page: Page) {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			})
	);
}

test('full Fuse engine is outside eager and dialog graphs; only search focus loads it once', async ({
	page
}) => {
	for (const file of engineFiles) {
		expect(eagerClientFiles.has(file)).toBe(false);
		expect(staticClientFiles(['src/lib/components/DetailDialog.svelte']).has(file)).toBe(false);
	}
	const engineSource = readFileSync(
		new URL(`../.svelte-kit/output/client${engineScript}`, import.meta.url),
		'utf8'
	);
	for (const marker of ['7.5.0', 'useTokenSearch', 'tokenMatch', '_coversAllTokens'])
		expect(engineSource).toContain(marker);
	for (const file of eagerClientFiles) {
		const source = readFileSync(
			new URL(`../.svelte-kit/output/client/${file}`, import.meta.url),
			'utf8'
		);
		expect(source).not.toContain('useTokenSearch');
	}
	const requested: string[] = [];
	page.on('request', (request) => requested.push(new URL(request.url()).pathname));
	await openGrid(page);
	await page.locator('.tile').first().hover();
	await page.locator('.tile').first().focus();
	await page.locator('.tile').first().click();
	await expect(page.getByRole('dialog', { name: 'Immich', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	for (const file of engineFiles) expect(requested).not.toContain('/' + file);
	const dialogRequests = requested.filter((path) => path === dialogScript).length;
	await searchInput(page).focus();
	await expect.poll(() => requested.filter((path) => path === engineScript).length).toBe(1);
	await searchInput(page).fill('backup');
	await expectTitles(page, ['Immich']);
	await page.getByRole('button', { name: 'Clear search', exact: true }).click();
	await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).focus();
	await searchInput(page).focus();
	await searchInput(page).fill('drome');
	await expectTitles(page, ['Navidrome']);
	expect(requested.filter((path) => path === engineScript)).toHaveLength(1);
	expect(requested.filter((path) => path === dialogScript)).toHaveLength(dialogRequests);
});

test('empty focus quietly warms search without moving or reloading the full directory', async ({
	page
}) => {
	const delayed = await holdEngine(page);
	try {
		await openGrid(page);
		await expect(page.locator('.tile img').last()).toBeVisible();
		await page.waitForLoadState('networkidle');
		const watch = await watchSearchStability(page);
		const before = await watch.read();
		await searchInput(page).focus();
		await delayed.requested;
		await finishRendering(page);
		const during = await watch.expectStable();
		delayed.release();
		await delayed.settled;
		await finishRendering(page);
		console.log('empty focus stability', { before, during, after: await watch.read() });
		await watch.expectStable();
		expect(during.status).toBe('');
		expect((await watch.read()).statuses).not.toContain('Loading search…');
		await expect(page.getByRole('status')).toBeEmpty();
		await watch.stop();
	} finally {
		delayed.release();
		await page.unrouteAll({ behavior: 'wait' });
	}
});

test('refocusing a completed filter preserves result nodes, images, order and positions', async ({
	page
}) => {
	await openGrid(page);
	await searchInput(page).fill('amberquartz');
	await expectTitles(page, ['amberquartz', 'Documents', 'Notes', 'Weather']);
	await finishRendering(page);
	await page.waitForLoadState('networkidle');
	const watch = await watchSearchStability(page);
	for (const source of ['utility', 'grid']) {
		if (source === 'utility') {
			await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).focus();
			await searchInput(page).focus();
		} else {
			await searchInput(page).press('ArrowDown');
			await expect(
				page.getByRole('list', { name: 'Search results', exact: true }).getByRole('link').first()
			).toBeFocused();
			await page.keyboard.press('Escape');
		}
		await finishRendering(page);
		await expect(searchInput(page)).toBeFocused();
		console.log('filtered refocus stability', source, await watch.read());
		const state = await watch.expectStable();
		expect(state.groupedIntervals).toBe(0);
		await expectTitles(page, ['amberquartz', 'Documents', 'Notes', 'Weather']);
	}
	await watch.stop();
});

test('nonempty query replacements never publish an intervening grouped directory', async ({
	page
}) => {
	await openGrid(page);
	await searchInput(page).fill('amberquartz');
	await expectTitles(page, ['amberquartz', 'Documents', 'Notes', 'Weather']);
	const watch = await watchSearchStability(page);
	for (const [query, titles] of [
		['backup', ['Immich']],
		['drome', ['Navidrome']],
		['amberquartz', ['amberquartz', 'Documents', 'Notes', 'Weather']]
	] as [string, string[]][]) {
		await searchInput(page).fill(query);
		await expectTitles(page, titles);
	}
	expect((await watch.read()).groupedIntervals).toBe(0);
	await watch.stop();
	await page.getByRole('button', { name: 'Clear search', exact: true }).click();
	await expectTitles(page, originalTitles);
	await expect(page.locator('.groups h2')).toHaveText(groupLabels);
});

test('a native input event can activate search without a preceding focus', async ({ page }) => {
	const requested: string[] = [];
	page.on('request', (request) => requested.push(new URL(request.url()).pathname));
	await openGrid(page);
	expect(requested).not.toContain(engineScript);
	await searchInput(page).evaluate((input: HTMLInputElement) => {
		input.value = 'drome';
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await expect(searchInput(page)).not.toBeFocused();
	await expectTitles(page, ['Navidrome']);
	expect(requested.filter((path) => path === engineScript)).toHaveLength(1);
});

test('ranked flat tiles cover weighted metadata, real typos, unordered multiword and long descriptions', async ({
	page
}) => {
	await openGrid(page);
	for (const [query, titles] of [
		['amberquartz', ['amberquartz', 'Documents', 'Notes', 'Weather']],
		['jelyfin', ['Jellyfin']],
		['drome', ['Navidrome']],
		['immich backup', ['Immich']],
		['backup immich', ['Immich']],
		['family photos', ['Immich']],
		['photos family', ['Immich']],
		['constellation orchard meadow telescope lantern archive copper', ['Calendar']],
		['snapshots', ['Immich']],
		['slug-observatory', ['Weather']],
		['pressure', ['Weather']],
		['Media backup', ['Immich']],
		['requires authentication', ['Immich']],
		['internal only', ['Navidrome']],
		['admin only', ['Weather']]
	] as [string, string[]][]) {
		await searchInput(page).fill(query);
		await expectTitles(page, titles);
		await expect(page.locator('.groups h2')).toHaveCount(0);
		await expect(page.getByRole('status')).toContainText(`${titles.length} bookmark`);
	}
	const result = page.locator('.tile');
	await expect(result.locator('.group-caption')).toHaveText('amberquartz');
	await expect(result).toHaveAttribute('href', '/?link=slug-observatory');
	await expect(result).toHaveAttribute('data-sveltekit-preload-data', 'off');
	await expect(result.locator('img')).toHaveCSS('width', '64px');
});

test('keyboard order, no results, whitespace and clear restore configured grouping and input focus', async ({
	page
}) => {
	await openGrid(page);
	await page.keyboard.press('Tab');
	await expect(searchInput(page)).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(
		page.getByRole('button', { name: 'Switch to dark theme', exact: true })
	).toBeFocused();
	await searchInput(page).fill('zzzxxyyqqq');
	await expect(page.getByRole('status')).toHaveText('No bookmarks found.');
	await expectTitles(page, []);
	await page.keyboard.press('Tab');
	await expect(page.getByRole('button', { name: 'Clear search', exact: true })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(searchInput(page)).toBeFocused();
	await expect(searchInput(page)).toHaveValue('');
	await expectTitles(page, originalTitles);
	await expect(page.locator('.groups h2')).toHaveText(groupLabels);
	await searchInput(page).fill('  ');
	await expectTitles(page, originalTitles);
	await expect(page.locator('.groups h2')).toHaveText(groupLabels);
	await expect(page.getByRole('status')).toBeEmpty();
	await searchInput(page).fill('backup');
	await expect(page.getByRole('status')).toHaveText('1 bookmark found.');
});

test('Enter opens the sole ready result through its real detail URL and retains it after Escape', async ({
	page
}) => {
	await openGrid(page);
	await searchInput(page).fill('backup');
	await expectTitles(page, ['Immich']);
	const tile = page.getByRole('list', { name: 'Search results', exact: true }).getByRole('link');
	const originalTile = await tile.elementHandle();
	await searchInput(page).press('Enter');
	await expect(page).toHaveURL(`${server.url}/?link=immich`);
	await expect(page.getByRole('dialog', { name: 'Immich', exact: true })).toBeVisible();
	await expect(
		page.getByRole('link', { name: 'Open service (opens in a new tab)', exact: true })
	).toHaveAttribute('href', 'https://photos.example.test/');
	await page.keyboard.press('Escape');
	await expect(tile).toBeFocused();
	await expect(searchInput(page)).toHaveValue('backup');
	expect(await tile.evaluate((node, original) => node === original, originalTile)).toBe(true);
	await page.goForward();
	await expect(page.getByRole('dialog', { name: 'Immich', exact: true })).toBeVisible();
	await page.goBack();
	await expect(tile).toBeFocused();
});

for (const change of ['type', 'clear'] as const) {
	test(`query ${change} cancels a sole-result Enter waiting for the dialog chunk`, async ({
		page
	}) => {
		const delayed = await holdChunk(page, dialogScript);
		try {
			await openGrid(page);
			await searchInput(page).fill('backup');
			await expectTitles(page, ['Immich']);
			await searchInput(page).press('Enter');
			await delayed.requested;
			await expect(searchInput(page)).toBeFocused();
			if (change === 'type') {
				await searchInput(page).fill('drome');
				await expectTitles(page, ['Navidrome']);
			} else {
				await page.getByRole('button', { name: 'Clear search', exact: true }).click();
				await expectTitles(page, originalTitles);
			}
			delayed.release();
			await delayed.settled;
			await finishRendering(page);
			await expect(page.getByRole('dialog')).toHaveCount(0);
			await expect(page).toHaveURL(`${server.url}/`);
			await expect(searchInput(page)).toBeFocused();
		} finally {
			delayed.release();
			await page.unrouteAll({ behavior: 'wait' });
		}
	});
}

test('Enter with pending, zero or several results never imports details or activates stale results', async ({
	page
}) => {
	const delayed = await holdEngine(page);
	const requested: string[] = [];
	page.on('request', (request) => requested.push(new URL(request.url()).pathname));
	try {
		await openGrid(page);
		await searchInput(page).fill('backup');
		await delayed.requested;
		await searchInput(page).press('Enter');
		await searchInput(page).press('ArrowDown');
		await expect(searchInput(page)).toBeFocused();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		delayed.release();
		await delayed.settled;
		await expectTitles(page, ['Immich']);
		await searchInput(page).evaluate((input: HTMLInputElement) => {
			input.value = 'zzzxxyyqqq';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			input.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
			);
		});
		await expect(page.getByRole('status')).toHaveText('No bookmarks found.');
		await searchInput(page).press('Enter');
		await searchInput(page).press('ArrowDown');
		await expect(searchInput(page)).toBeFocused();
		await expect(page.getByRole('list', { name: 'Search results', exact: true })).toHaveCount(0);
		await searchInput(page).fill('amberquartz');
		await expectTitles(page, ['amberquartz', 'Documents', 'Notes', 'Weather']);
		await searchInput(page).press('Enter');
		await expect(
			page.getByRole('list', { name: 'Search results', exact: true }).getByRole('link').first()
		).toBeFocused();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(requested).not.toContain(dialogScript);
	} finally {
		delayed.release();
		await page.unrouteAll({ behavior: 'wait' });
	}
});

test('IME and modified input keys leave activation, editing and clearing alone', async ({
	page
}) => {
	const requested: string[] = [];
	page.on('request', (request) => requested.push(new URL(request.url()).pathname));
	await openGrid(page);
	await searchInput(page).fill('backup');
	await expectTitles(page, ['Immich']);
	for (const key of ['Enter', 'ArrowDown', 'Escape']) {
		for (const options of [
			{ isComposing: true },
			{ keyCode: 229 },
			{ ctrlKey: true },
			{ metaKey: true },
			{ shiftKey: true },
			{ altKey: true }
		]) {
			const prevented = await searchInput(page).evaluate(
				(input, { key, options }) => {
					return !input.dispatchEvent(
						new KeyboardEvent('keydown', { key, ...options, bubbles: true, cancelable: true })
					);
				},
				{ key, options }
			);
			expect(prevented).toBe(false);
			await expect(searchInput(page)).toBeFocused();
			await expect(searchInput(page)).toHaveValue('backup');
		}
	}
	await searchInput(page).press('Home');
	await searchInput(page).press('ArrowRight');
	expect(await searchInput(page).evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(
		1
	);
	expect(requested).not.toContain(dialogScript);
	await searchInput(page).press('Escape');
	await expectTitles(page, originalTitles);
	await expect(searchInput(page)).toHaveValue('');
	await expect(page.getByRole('list', { name: 'Search results', exact: true })).toHaveCount(0);
});

test('search and dialog history retain query, ranked results and connected return tile without fetching data', async ({
	page
}) => {
	await openGrid(page);
	const dataRequests: string[] = [];
	page.on('request', (request) => {
		if (request.isNavigationRequest() || request.url().includes('__data.json'))
			dataRequests.push(request.url());
	});
	await searchInput(page).fill('backup');
	await expectTitles(page, ['Immich']);
	const tile = page.locator('.tile');
	const originalTile = await tile.elementHandle();
	await tile.click();
	await expect(page.getByRole('dialog', { name: 'Immich', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(tile).toBeFocused();
	await page.goForward();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.goBack();
	await expect(tile).toBeFocused();
	await expect(searchInput(page)).toHaveValue('backup');
	await expectTitles(page, ['Immich']);
	expect(await tile.evaluate((node, previous) => node === previous, originalTile)).toBe(true);
	expect(dataRequests).toEqual([]);
	await navigateQuery(page, '/?link=navidrome');
	await expect(page.getByRole('dialog', { name: 'Navidrome', exact: true })).toBeVisible();
	await expect(searchInput(page)).toHaveValue('backup');
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
	await expectTitles(page, ['Immich']);
});

for (const ending of ['latest query', 'clear']) {
	test(`delayed focus/input keeps only ${ending} and one shared load`, async ({ page }) => {
		const delayed = await holdEngine(page);
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		try {
			await openGrid(page);
			await searchInput(page).focus();
			await delayed.requested;
			await expect(page.getByRole('status')).toBeEmpty();
			await searchInput(page).fill('jelyfin');
			await expect(page.getByRole('status')).toHaveText('Loading search…');
			const watch = await watchSearchStability(page);
			await searchInput(page).fill('drome');
			await watch.expectStable();
			await watch.stop();
			if (ending === 'clear')
				await page.getByRole('button', { name: 'Clear search', exact: true }).click();
			delayed.release();
			await delayed.settled;
			if (ending === 'clear') {
				await expect(page.getByRole('status')).toBeEmpty();
				await expectTitles(page, originalTitles);
				await expect(page.locator('.groups h2')).toHaveText(groupLabels);
				await expect(searchInput(page)).toBeFocused();
			} else {
				await expectTitles(page, ['Navidrome']);
				await expect(page.getByRole('status')).toHaveText('1 bookmark found.');
			}
			expect(errors).toEqual([]);
		} finally {
			delayed.release();
			await page.unrouteAll({ behavior: 'wait' });
		}
	});
}

for (const state of ['loading', 'loaded']) {
	test(`native snapshot replacement while ${state} rebuilds results; local search stays on its loaded model`, async ({
		page
	}) => {
		const app = await startServer({ configuration, secret: null, origin: null });
		let delayed: Awaited<ReturnType<typeof holdEngine>> | undefined;
		try {
			await app.ready();
			if (state === 'loading') delayed = await holdEngine(page);
			await openGrid(page, app.url);
			await searchInput(page).fill('backup');
			if (delayed) await delayed.requested;
			else await expectTitles(page, ['Immich']);
			await app.replace(
				configuration.replace('title: Immich', 'title: Paperless').replace('snapshots', 'scanning')
			);
			await expect.poll(async () => (await app.fetch('/')).text()).toContain('Paperless');
			if (!delayed) {
				await searchInput(page).fill('scanning');
				await expect(page.getByRole('status')).toHaveText('No bookmarks found.');
				await searchInput(page).fill('backup');
				await expectTitles(page, ['Immich']);
			}
			await navigateQuery(page, '/?link=navidrome');
			await expect(page.getByRole('dialog', { name: 'Navidrome', exact: true })).toBeVisible();
			delayed?.release();
			await expectTitles(page, ['Paperless']);
			await expect(searchInput(page)).toHaveValue('backup');
			await page.getByRole('button', { name: 'Close', exact: true }).click();
			await searchInput(page).fill('scanning');
			await expectTitles(page, ['Paperless']);
		} finally {
			delayed?.release();
			await page.unrouteAll({ behavior: 'wait' });
			expect(await app.stop()).toEqual({ code: 0, signal: null });
		}
	});
}

test('unmount discards a pending search completion', async ({ page }) => {
	const delayed = await holdEngine(page);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	try {
		await openGrid(page);
		await searchInput(page).fill('backup');
		await delayed.requested;
		await navigateQuery(page, '/missing');
		delayed.release();
		await delayed.settled;
		await finishRendering(page);
		await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
		await expect(page.getByRole('status')).toHaveCount(0);
		expect(errors).toEqual([]);
	} finally {
		delayed.release();
		await page.unrouteAll({ behavior: 'wait' });
	}
});

for (const entry of ['grid', 'direct']) {
	test(`failed search leaves ${entry} navigation and full grid usable without reload loops`, async ({
		page
	}) => {
		const errors: string[] = [];
		let chunks = 0;
		let documents = 0;
		page.on('pageerror', (error) => errors.push(error.message));
		page.on('request', (request) => {
			if (request.isNavigationRequest()) documents++;
		});
		await page.route(`**${engineScript}`, (route) => {
			chunks++;
			return route.abort();
		});
		if (entry === 'direct') await page.route(`**${dialogScript}`, (route) => route.abort());
		await openGrid(page, `${server.url}/${entry === 'direct' ? '?link=navidrome' : ''}`);
		await searchInput(page).fill('backup');
		await expect(page.getByRole('status')).toHaveText('Search unavailable. Reload to try again.');
		await expect(page.getByRole('list', { name: 'Search results', exact: true })).toHaveCount(0);
		await expect(page.locator('.groups').getByRole('list')).toHaveCount(4);
		await expectTitles(page, originalTitles);
		await expect(page.locator('.groups h2')).toHaveText(groupLabels);
		await finishRendering(page);
		expect(chunks).toBe(1);
		expect(documents).toBe(1);
		if (entry === 'direct') {
			await expect(page.getByRole('region', { name: 'Navidrome', exact: true })).toBeVisible();
			await expect(
				page.getByRole('link', { name: 'Back to directory', exact: true })
			).toBeVisible();
		} else {
			await page.locator('a[href="/?link=navidrome"]').click();
			await expect(page.getByRole('dialog', { name: 'Navidrome', exact: true })).toBeVisible();
			await page.getByRole('button', { name: 'Close', exact: true }).click();
		}
		const status = page.getByRole('status');
		await status.evaluate((node) => {
			const observer = new MutationObserver(() => {
				if (node.textContent?.includes('Loading search')) node.dataset.loadingSeen = 'true';
			});
			observer.observe(node, { childList: true, subtree: true, characterData: true });
		});
		await searchInput(page).fill('drome');
		await finishRendering(page);
		await expect(status).toHaveText('Search unavailable. Reload to try again.');
		await page.getByRole('button', { name: 'Clear search', exact: true }).click();
		await expect(searchInput(page)).toHaveValue('');
		await expect(searchInput(page)).toBeFocused();
		await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).focus();
		await searchInput(page).focus();
		await searchInput(page).fill('photos');
		await finishRendering(page);
		await expect(status).toHaveText('Search unavailable. Reload to try again.');
		await expect(status).not.toHaveAttribute('data-loading-seen');
		await expectTitles(page, originalTitles);
		expect(chunks).toBe(1);
		expect(documents).toBe(1);
		expect(errors).toEqual([]);
		await page.unroute(`**${engineScript}`);
		await page.goto(server.url);
		await expect(searchInput(page)).toBeEnabled();
		await searchInput(page).fill('backup');
		await expectTitles(page, ['Immich']);
	});
}

for (const colorScheme of ['light', 'dark'] as const) {
	for (const javaScriptEnabled of [true, false]) {
		test(`search header and full SSR navigation at phone/desktop: ${colorScheme}, JS ${javaScriptEnabled}`, async ({
			browser
		}) => {
			const context = await browser.newContext({ colorScheme, javaScriptEnabled });
			try {
				const page = await context.newPage();
				for (const width of [360, 1280]) {
					await page.setViewportSize({ width, height: 900 });
					const response = await page.goto(server.url);
					const html = await response!.text();
					for (const title of originalTitles) expect(html).toContain(title);
					if (javaScriptEnabled) {
						await expect(searchInput(page)).toBeEnabled();
						await searchInput(page).fill('backup');
						await expectTitles(page, ['Immich']);
						await expect(searchInput(page)).toHaveCSS(
							'outline-color',
							colorScheme === 'light' ? 'rgb(19, 87, 155)' : 'rgb(226, 196, 166)'
						);
						await expect(
							page.getByRole('button', { name: 'Clear search', exact: true })
						).toBeInViewport();
					} else {
						await expect(searchInput(page)).toBeDisabled();
						await expectTitles(page, originalTitles);
					}
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
					).toBe(true);
					await page.locator('a[href="/?link=immich"]').click();
					if (javaScriptEnabled) {
						await expect(page.getByRole('dialog', { name: 'Immich', exact: true })).toBeVisible();
						await page.getByRole('button', { name: 'Close', exact: true }).click();
					} else {
						await expect(page.getByRole('region', { name: 'Immich', exact: true })).toBeVisible();
						await page.getByRole('link', { name: 'Back to directory', exact: true }).click();
					}
				}
			} finally {
				await context.close();
			}
		});
	}
}

test('search stays behind authentication; sign-out retains only public branding', async ({
	page
}) => {
	const app = await startServer({ configuration: configuration + credentialsAuth });
	try {
		await app.ready();
		await page.setViewportSize({ width: 360, height: 900 });
		await page.goto(app.url);
		await expect(searchInput(page)).toHaveCount(0);
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(searchInput(page)).toBeEnabled();
		await searchInput(page).fill('family photos');
		await expectTitles(page, ['Immich']);
		const signout = page.getByRole('button', { name: 'Sign out', exact: true });
		for (const width of [360, 1280]) {
			await page.setViewportSize({ width, height: 900 });
			await expect(signout).toBeInViewport();
			const fieldBox = (await searchInput(page).boundingBox())!;
			const themeBox = (await page
				.getByRole('button', { name: 'Switch to dark theme', exact: true })
				.boundingBox())!;
			const signoutBox = (await signout.boundingBox())!;
			expect(themeBox.y + themeBox.height / 2).toBe(signoutBox.y + signoutBox.height / 2);
			if (width === 360) {
				const brandBox = (await page.locator('main > header > div').first().boundingBox())!;
				const logoBox = (await page.locator('main > header img').boundingBox())!;
				expect(fieldBox.width).toBe(328);
				expect(fieldBox.y).toBe(brandBox.y + brandBox.height + 16);
				expect(fieldBox.y).toBeGreaterThanOrEqual(themeBox.y + themeBox.height);
				expect(themeBox.y + themeBox.height / 2).toBe(logoBox.y + logoBox.height / 2);
			} else {
				expect(fieldBox.y + fieldBox.height / 2).toBe(themeBox.y + themeBox.height / 2);
			}
		}
		await page.setViewportSize({ width: 360, height: 900 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await signout.click();
		await expect(page).toHaveURL(/\/signin\?callbackUrl=%2F$/);
		await expect(searchInput(page)).toHaveCount(0);
		for (const path of ['/signin', '/signin/__data.json', '/__data.json']) {
			const response = await page.request.get(app.url + path);
			expect(response.status()).toBe(path === '/__data.json' ? 401 : 200);
			const payload = await response.text();
			if (path === '/signin') {
				expect(payload).toContain('--color-primary:light-dark(#13579b,#e2c4a6)');
			} else {
				expect(payload).not.toContain('--color-primary');
			}
			for (const value of [
				'Private household directory',
				'photos.example.test',
				username,
				password,
				app.secret!,
				app.path
			])
				expect(payload).not.toContain(value);
		}
	} finally {
		expect(await app.stop()).toEqual({ code: 0, signal: null });
	}
});
