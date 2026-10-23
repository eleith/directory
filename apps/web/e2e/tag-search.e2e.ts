import { expect, test, type Page } from '@playwright/test';
import { clientManifest, directoryScript } from './support/details.js';
import { startServer, type TestServer } from './support/server.js';

const engineScript = '/' + clientManifest['src/lib/search/engine.ts']!.file;
const configuration = `site:
  title: Tag search fixture
  footer: Ask the household maintainer.
appearance:
  primary_light_color: '#13579b'
  primary_dark_color: '#e2c4a6'
links:
  archive:
    title: Family archive
    url: https://archive.example.test/
    group: Media
    tags: PhOtOs, Family Photos, Album Vault
    requires_auth: true
    internal_only: true
    admin_only: true
  travel:
    title: Travel albums
    url: https://travel.example.test/
    group: Media
    tags: photos
  shared:
    title: Shared albums
    url: https://shared.example.test/
    group: Records
    tags: '  FAMILY PHOTOS  '
    requires_auth: true
  decoy:
    title: photos
    url: https://notes.example.test/
    group: Records
    description: Family photos, login, internal and admin are only words here.
    tags: login, internal, admin, topic:orchard, access:login
    requires_auth: false
    internal_only: false
    admin_only: false
  internal:
    title: Private notes
    url: https://internal.example.test/
    group: Records
    internal_only: true
  admin:
    title: Maintenance
    url: https://maintenance.example.test/
    group: Operations
    admin_only: true
`;
const originalTitles = [
	'Family archive',
	'Travel albums',
	'Shared albums',
	'photos',
	'Private notes',
	'Maintenance'
];
let server: TestServer;

test.beforeAll(async () => {
	server = await startServer({ configuration, secret: null, origin: null });
	await server.ready();
});
test.afterAll(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
});

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search', exact: true });
const chip = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function expectTitles(page: Page, titles: string[]) {
	await expect(page.locator('.tile > .tile-title')).toHaveText(titles);
}

async function expectGroups(page: Page) {
	await expectTitles(page, originalTitles);
	await expect(page.locator('.groups h2')).toHaveText(['Media', 'Records', 'Operations']);
}

test('typed whole-tag queries ignore title, description and advisory decoys; spaces and punctuation stay literal', async ({
	page
}) => {
	await page.goto(server.url);
	await expect(search(page)).toBeEnabled();
	await search(page).fill('  TaG:  PHOTOS  ');
	await expectTitles(page, ['Family archive', 'Travel albums']);
	await expect(page.locator('.groups h2')).toHaveCount(0);
	await expect(page.locator('.tile .group-caption')).toHaveText(['Media', 'Media']);
	await search(page).fill('tag: FaMiLy PhOtOs ');
	await expectTitles(page, ['Family archive', 'Shared albums']);
	await search(page).fill('tag:login');
	await expectTitles(page, ['photos']);
	await search(page).fill('tag:access:login');
	await expectTitles(page, ['photos']);
	for (const query of [
		'tag:',
		'tag:photo',
		'tag:family  photos',
		'tag:"photos"',
		'tag:photos OR login'
	]) {
		await search(page).fill(query);
		await expect(page.getByRole('status')).toHaveText('No bookmarks found.');
		await expectTitles(page, []);
	}
	await search(page).fill('topic:orchard');
	await expectTitles(page, ['photos']);
	await page.getByRole('button', { name: 'Clear search', exact: true }).click();
	await expect(search(page)).toBeFocused();
	await expectGroups(page);
});

test('the three access queries select enabled booleans, not identically named custom tags or prose', async ({
	page
}) => {
	await page.goto(server.url);
	await expect(search(page)).toBeEnabled();
	await search(page).fill(' ACCESS: LOGIN ');
	await expectTitles(page, ['Family archive', 'Shared albums']);
	await search(page).fill('access:internal');
	await expectTitles(page, ['Family archive', 'Private notes']);
	await search(page).fill('access:admin');
	await expectTitles(page, ['Family archive', 'Maintenance']);
	for (const query of [
		'access:',
		'access:authentication',
		'access:admin only',
		'access:login tag:photos'
	]) {
		await search(page).fill(query);
		await expect(page.getByRole('status')).toHaveText('No bookmarks found.');
		await expectTitles(page, []);
	}
	await page.getByRole('button', { name: 'Clear search', exact: true }).click();
	await expectGroups(page);
	await page.locator('a[href="/?link=admin"]').click();
	await expect(page.getByRole('dialog', { name: 'Maintenance', exact: true })).toBeVisible();
	await expect(
		page.getByRole('link', { name: 'Open Maintenance (opens in a new tab)', exact: true })
	).toHaveAttribute('href', 'https://maintenance.example.test/');
});

test('a tile-only visit stays lazy until a detail chip closes Bits and focuses Search', async ({
	page
}) => {
	const requested: string[] = [];
	let engineStart: { dialogs: number; searchFocused: boolean } | undefined;
	page.on('request', (request) => requested.push(new URL(request.url()).pathname));
	await page.route(`**${engineScript}`, async (route) => {
		engineStart = await page.evaluate(() => ({
			dialogs: document.querySelectorAll('[role="dialog"]').length,
			searchFocused: document.activeElement?.id === 'directory-search'
		}));
		await route.continue();
	});
	await page.goto(server.url);
	await expect(search(page)).toBeEnabled();
	await expect(search(page)).not.toBeFocused();
	const tile = page.locator('a[href="/?link=archive"]');
	await tile.hover();
	await tile.click();
	await expect(page.getByRole('dialog', { name: 'Family archive', exact: true })).toBeVisible();
	await expect(
		page.getByRole('link', { name: 'Open Family archive (opens in a new tab)', exact: true })
	).toBeFocused();
	expect(requested).not.toContain(engineScript);
	await chip(page, 'Filter by tag: photos').click();
	await expect(page).toHaveURL(`${server.url}/?q=tag%3Aphotos`);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(search(page)).toBeFocused();
	await expect(search(page)).toHaveValue('tag:photos');
	await expectTitles(page, ['Family archive', 'Travel albums']);
	expect(engineStart).toEqual({ dialogs: 0, searchFocused: true });
	expect(requested.filter((path) => path === engineScript)).toHaveLength(1);
	expect(requested.filter((path) => path === directoryScript)).toHaveLength(1);
	expect(requested.filter((path) => path.includes('__data.json'))).toEqual([]);
	await page.getByRole('button', { name: 'Clear search', exact: true }).click();
	await expect(search(page)).toBeFocused();
	await expectGroups(page);
});

test('a chip replaces an existing query without reopening a sole match; later result history restores tile focus', async ({
	page
}) => {
	await page.goto(server.url);
	await expect(search(page)).toBeEnabled();
	await search(page).fill('archive');
	await expectTitles(page, ['Family archive']);
	await page.locator('.tile').click();
	await expect(page.getByRole('dialog', { name: 'Family archive', exact: true })).toBeVisible();
	await chip(page, 'Filter by tag: album vault').click();
	await expect(page).toHaveURL(`${server.url}/?q=tag%3Aalbum+vault`);
	await expect(search(page)).toHaveValue('tag:album vault');
	await expect(search(page)).toBeFocused();
	await expect(page.getByRole('status')).toHaveText('1 bookmark found.');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expectTitles(page, ['Family archive']);
	await search(page).press('Enter');
	const external = page.getByRole('link', {
		name: 'Open Family archive (opens in a new tab)',
		exact: true
	});
	await expect(external).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.locator('.tile')).toBeFocused();
	await expect(search(page)).toHaveValue('tag:album vault');
	await page.goForward();
	await expect(external).toBeFocused();
	await page.goBack();
	await expect(page.locator('.tile')).toBeFocused();
	await expect(search(page)).toHaveValue('tag:album vault');
	await page.getByRole('button', { name: 'Clear search', exact: true }).click();
	await expectGroups(page);
});

test('direct details replace their URL on native Enter activation; native Space activates an access chip next', async ({
	page
}) => {
	await page.goto(`${server.url}/?link=archive`);
	const external = page.getByRole('link', {
		name: 'Open Family archive (opens in a new tab)',
		exact: true
	});
	await expect(external).toBeFocused();
	const historyLength = await page.evaluate(() => history.length);
	await page.keyboard.press('Shift+Tab');
	await expect(page.getByRole('textbox', { name: 'Destination', exact: true })).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	const tag = chip(page, 'Filter by tag: album vault');
	await expect(tag).toBeFocused();
	await expect(tag).toHaveAttribute('type', 'button');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(`${server.url}/?q=tag%3Aalbum+vault`);
	expect(await page.evaluate(() => history.length)).toBe(historyLength);
	await expect(search(page)).toBeFocused();
	await expect(search(page)).toHaveValue('tag:album vault');
	await expect(page.getByRole('status')).toHaveText('1 bookmark found.');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.locator('.tile').click();
	await expect(external).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
	await page.keyboard.press('Tab');
	const login = chip(page, 'Filter by access: login');
	await expect(login).toBeFocused();
	await expect(login).toHaveAttribute('type', 'button');
	await page.keyboard.press('Space');
	await expect(page).toHaveURL(`${server.url}/?q=access%3Alogin`);
	await expect(search(page)).toBeFocused();
	await expect(search(page)).toHaveValue('access:login');
	await expectTitles(page, ['Family archive', 'Shared albums']);
	await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('no JavaScript retains informational details; blocked boot retains only the native grid and footer', async ({
	browser
}) => {
	for (const mode of ['no JavaScript', 'blocked boot']) {
		const context = await browser.newContext({ javaScriptEnabled: mode !== 'no JavaScript' });
		try {
			const page = await context.newPage();
			const requested: string[] = [];
			page.on('request', (request) => requested.push(new URL(request.url()).pathname));
			if (mode === 'blocked boot') await page.route('**/*.js', (route) => route.abort());
			await page.goto(`${server.url}/?link=archive`);
			const section = page.getByRole('region', { name: 'Family archive', exact: true });
			if (mode === 'blocked boot') {
				await expect(section).toHaveCount(0);
				await expect(page.getByRole('dialog')).toHaveCount(0);
				await expect(search(page)).toBeDisabled();
				await expectGroups(page);
				await expect(page.locator('footer')).toHaveText('Ask the household maintainer.');
				const tile = page.locator('a[href="/?link=travel"]');
				await expect(tile).toHaveAttribute('data-sveltekit-preload-data', 'off');
				await tile.click();
				await expect(page).toHaveURL(`${server.url}/?link=travel`);
				await expect(page.getByRole('region', { name: 'Travel albums', exact: true })).toHaveCount(
					0
				);
				await expect(page.getByRole('dialog')).toHaveCount(0);
				await expectGroups(page);
				expect(requested).not.toContain(engineScript);
				expect(requested.filter((path) => path.includes('__data.json'))).toEqual([]);
				continue;
			}
			await expect(section).toBeVisible();
			await expect(search(page)).toBeDisabled();
			await expect(page.getByRole('dialog')).toHaveCount(0);
			const tags = section.getByRole('list', { name: 'Tags', exact: true });
			await expect(tags.locator('span.tag')).toHaveText([
				'login',
				'internal',
				'admin',
				'photos',
				'family photos',
				'album vault'
			]);
			await expect(tags.locator('button, a, [tabindex]')).toHaveCount(0);
			await expect(tags.getByRole('listitem', { name: 'admin only', exact: true })).toHaveText(
				'admin'
			);
			const photos = tags.locator('span.tag').nth(3);
			await expect(photos).toHaveCSS('cursor', 'auto');
			await page.waitForLoadState('networkidle');
			const requestsBeforeClick = requested.length;
			await photos.click();
			await page.waitForLoadState('networkidle');
			expect(requested).toHaveLength(requestsBeforeClick);
			await expect(photos).toHaveCSS('text-decoration-line', 'none');
			await expect(page).toHaveURL(`${server.url}/?link=archive`);
			await expect(search(page)).toHaveValue('');
			await expect(
				section.getByRole('link', {
					name: 'Open Family archive (opens in a new tab)',
					exact: true
				})
			).toHaveAttribute('href', 'https://archive.example.test/');
			await expect(section.getByRole('textbox', { name: 'Destination', exact: true })).toHaveValue(
				'https://archive.example.test/'
			);
			await expect(page.locator('footer')).toHaveText('Ask the household maintainer.');
			await section.getByRole('link', { name: 'Back to directory', exact: true }).click();
			await expect(page).toHaveURL(`${server.url}/`);
			await expectGroups(page);
			expect(requested).not.toContain(engineScript);
			expect(requested.filter((path) => path.includes('__data.json'))).toEqual([]);
		} finally {
			await context.close();
		}
	}
});

test('a chip-triggered engine failure stays latched through another selection and Clear, without a reload or stale Enter', async ({
	page
}) => {
	let chunks = 0;
	let documents = 0;
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('request', (request) => {
		if (request.isNavigationRequest()) documents++;
	});
	await page.route(`**${engineScript}`, (route) => {
		chunks++;
		return route.abort();
	});
	await page.goto(server.url);
	await expect(search(page)).toBeEnabled();
	await page.locator('a[href="/?link=archive"]').click();
	await expect(page.getByRole('dialog', { name: 'Family archive', exact: true })).toBeVisible();
	await chip(page, 'Filter by tag: photos').click();
	const status = page.getByRole('status');
	await expect(status).toHaveText('Search unavailable. Reload to try again.');
	await expect(search(page)).toBeFocused();
	await expect(search(page)).toHaveValue('tag:photos');
	await expectGroups(page);
	await search(page).press('Enter');
	await search(page).press('ArrowDown');
	await expect(search(page)).toBeFocused();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	const fallbackTile = page.locator('a[href^="/?link=archive"]');
	await expect(fallbackTile).toHaveAttribute('href', '/?link=archive&q=tag%3Aphotos');
	await fallbackTile.click();
	await expect(page.getByRole('dialog', { name: 'Family archive', exact: true })).toBeVisible();
	await chip(page, 'Filter by access: internal').click();
	await expect(search(page)).toHaveValue('access:internal');
	await expect(search(page)).toBeFocused();
	await expect(status).toHaveText('Search unavailable. Reload to try again.');
	await page.getByRole('button', { name: 'Clear search', exact: true }).click();
	await expect(search(page)).toHaveValue('');
	await expect(search(page)).toBeFocused();
	await expect(status).toHaveText('Search unavailable. Reload to try again.');
	await expectGroups(page);
	expect(chunks).toBe(1);
	expect(documents).toBe(1);
	expect(errors).toEqual([]);
});
