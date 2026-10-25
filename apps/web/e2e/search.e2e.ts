import { expect, test } from '@playwright/test';
import { startServer, type TestServer } from './support/server.js';

const configuration = `site:
  title: Household directory
links:
  photos:
    title: Family photos
    url: https://photos.example.test/
    group: Media
    tags: [family]
    requires_auth: true
  music:
    title: Music
    url: https://music.example.test/
    group: Media
    tags: [family]
  notes:
    title: Notes
    url: https://notes.example.test/
    group: Tools
    requires_auth: true
`;
let server: TestServer;

test.beforeAll(async () => {
	server = await startServer({ configuration, secret: null, origin: null });
	await server.ready();
});

test.afterAll(async () => {
	if (server) expect(await server.stop()).toEqual({ code: 0, signal: null });
});

test('search finds a bookmark, opens its details and clears back to browsing', async ({ page }) => {
	await page.goto(server.url);
	const search = page.getByRole('searchbox', { name: 'Search', exact: true });
	const results = page.getByRole('list', { name: 'Search results', exact: true });
	await expect(search).toBeEnabled();
	await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Media', 'Tools']);

	await search.fill('photos');
	await expect(results.getByRole('link')).toHaveCount(1);
	await expect(results.getByRole('link')).toContainText('Family photos');
	await expect(page).toHaveURL(`${server.url}/?q=photos`);
	await page.reload();
	await expect(search).toHaveValue('photos');
	await expect(results.getByRole('link')).toHaveCount(1);

	await results.getByRole('link').press('Enter');
	const details = page.getByRole('dialog', { name: 'Family photos', exact: true });
	await expect(details).toBeVisible();
	await expect(
		details.getByRole('link', { name: 'Open Family photos (opens in a new tab)', exact: true })
	).toHaveAttribute('href', 'https://photos.example.test/');
	await details.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(results.getByRole('link')).toBeFocused();
	await expect(search).toHaveValue('photos');

	await search.fill('zzzxxyyqqq');
	await expect(page.getByRole('status')).toHaveText('No bookmarks found.');
	await expect(results).toHaveCount(0);
	await page.getByRole('button', { name: 'Clear search', exact: true }).click();
	await expect(search).toHaveValue('');
	await expect(search).toBeFocused();
	await expect(page).toHaveURL(`${server.url}/`);
	await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Media', 'Tools']);
	await expect(page.getByRole('main').getByRole('link')).toHaveCount(3);
});

for (const { filter, query, titles } of [
	{ filter: 'tag: family', query: 'tag:family', titles: ['Family photos', 'Music'] },
	{ filter: 'access: login', query: 'access:login', titles: ['Family photos', 'Notes'] }
]) {
	test(`selecting ${filter} in details replaces the current search`, async ({ page }) => {
		await page.goto(`${server.url}/?q=photos`);
		const search = page.getByRole('searchbox', { name: 'Search', exact: true });
		const results = page.getByRole('list', { name: 'Search results', exact: true });
		await expect(results.getByRole('link')).toHaveCount(1);
		await results.getByRole('link').click();
		const details = page.getByRole('dialog', { name: 'Family photos', exact: true });
		await details.getByRole('button', { name: `Filter by ${filter}`, exact: true }).click();

		await expect(details).toHaveCount(0);
		await expect(search).toBeFocused();
		await expect(search).toHaveValue(query);
		await expect(page).toHaveURL(`${server.url}/?${new URLSearchParams({ q: query })}`);
		await expect(results.getByRole('link')).toHaveCount(titles.length);
		await expect(results.getByRole('link')).toContainText(titles);
	});
}
