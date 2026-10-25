import { expect, test } from '@playwright/test';
import { startServer } from './support/server.js';

const serviceURL = 'https://service.example.test/library?from=directory#latest';
const configuration = `links:
  archive:
    title: Family archive
    url: ${serviceURL}
    description: Shared household records.
`;

test('Open uses a new tab by default', async ({ page, context }) => {
	const server = await startServer({ configuration, secret: null, origin: null });
	try {
		await server.ready();
		await context.route('https://service.example.test/**', (route) =>
			route.fulfill({ contentType: 'text/html', body: '<h1>Service destination</h1>' })
		);
		await page.goto(server.url);
		await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeEnabled();
		const bookmark = page.getByRole('link', { name: 'Family archive', exact: true });
		await bookmark.press('Enter');
		const details = page.getByRole('dialog', { name: 'Family archive', exact: true });
		await expect(details).toBeVisible();
		const destination = details.getByRole('textbox', { name: 'Destination', exact: true });
		await expect(destination).toHaveValue(serviceURL);
		await expect(destination).toHaveJSProperty('readOnly', true);
		const open = details.getByRole('link', {
			name: 'Open Family archive (opens in a new tab)',
			exact: true
		});
		await expect(open).toHaveAttribute('href', serviceURL);
		await expect(open).toHaveAttribute('rel', 'noopener noreferrer');

		const opened = context.waitForEvent('page');
		await open.press('Enter');
		const service = await opened;
		await expect(service).toHaveURL(serviceURL);
		await expect(service.getByRole('heading', { name: 'Service destination' })).toBeVisible();
		await service.close();
		await expect(page).toHaveURL(`${server.url}/?link=archive`);
		await details.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(bookmark).toBeFocused();
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('Open uses the current tab when configured', async ({ page, context }) => {
	const server = await startServer({
		configuration: `site:\n  open_links_in_new_tab: false\n${configuration}`,
		secret: null,
		origin: null
	});
	try {
		await server.ready();
		await context.route('https://service.example.test/**', (route) =>
			route.fulfill({ contentType: 'text/html', body: '<h1>Service destination</h1>' })
		);
		await page.setViewportSize({ width: 360, height: 800 });
		await page.goto(`${server.url}/?link=archive`);
		const details = page.getByRole('dialog', { name: 'Family archive', exact: true });
		const open = details.getByRole('link', { name: 'Open Family archive', exact: true });
		await expect(open).toHaveAttribute('target', '_self');
		await open.click();
		await expect(page).toHaveURL(serviceURL);
		await expect(page.getByRole('heading', { name: 'Service destination' })).toBeVisible();
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});
