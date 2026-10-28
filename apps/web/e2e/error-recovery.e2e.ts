import { expect, test } from '@playwright/test';
import {
	configuration,
	password,
	privateSentinels,
	siteTitle,
	username
} from './support/configuration.js';
import { startServer } from './support/server.js';

test('without JavaScript missing routes and bookmarks recover with the keyboard', async ({
	browser
}) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const server = await startServer({ configuration: configuration('') });
	try {
		await server.ready();
		const page = await context.newPage();
		for (const path of ['/missing-page?message=UNTRUSTED_ERROR_COPY', '/?link=missing']) {
			const response = await page.goto(server.url + path);
			expect(response?.status()).toBe(404);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			await expect(page.getByText('404', { exact: true })).toBeVisible();
			const html = await page.content();
			for (const value of [...privateSentinels, server.path]) expect(html).not.toContain(value);
			await expect(page.locator('main')).not.toContainText('UNTRUSTED_ERROR_COPY');
			const recovery = page.getByRole('link', { name: 'Back to home', exact: true });
			await expect(recovery).toBeVisible();
			await expect(recovery).toHaveAttribute('href', '/');
			await page.keyboard.press('Tab');
			await expect(recovery).toBeFocused();
			await page.keyboard.press('Enter');
			await expect(page).toHaveURL(`${server.url}/`);
			await expect(page.getByRole('heading', { name: siteTitle, exact: true })).toBeVisible();
		}
	} finally {
		try {
			await context.close();
		} finally {
			await server.stop();
		}
	}
});

test('recovery preserves authentication and does not replace private API denials', async ({
	browser
}) => {
	const server = await startServer({ configuration: configuration() });
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		await server.ready();
		const denied = await server.fetch('/unknown', { headers: { accept: 'application/json' } });
		expect(denied.status).toBe(401);
		expect(await denied.text()).toBe('Access denied');
		const navigation = await server.fetch('/unknown', { headers: { accept: 'text/html' } });
		expect(navigation.status).toBe(303);
		expect(new URL(navigation.headers.get('location')!, server.url).pathname).toBe('/signin');
		const page = await context.newPage();
		await page.goto(`${server.url}/signin`);
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
		const response = await page.goto(`${server.url}/?link=missing`);
		expect(response?.status()).toBe(404);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		const html = await page.content();
		for (const value of [...privateSentinels, server.path]) expect(html).not.toContain(value);
		await page.getByRole('link', { name: 'Back to home', exact: true }).click();
		await expect(page).toHaveURL(`${server.url}/`);
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
	} finally {
		try {
			await context.close();
		} finally {
			await server.stop();
		}
	}
});
