import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';
import {
	configuration,
	password,
	privateSentinels,
	siteDescription,
	siteTitle,
	username
} from './support/configuration.js';
import { startServer, type TestServer } from './support/server.js';

const logoPath = '/public/config-update.svg';
const updatedTitle = 'Accepted update fixture';
const updatedDescription = 'Accepted update description';
const initialConfiguration =
	configuration().replace('site:\n', `site:\n  logo_path: ${logoPath}\n`) +
	`appearance:
  primary_light_color: '#13579b'
  primary_dark_color: '#e2c4a6'
`;
const updatedConfiguration = initialConfiguration
	.replace(siteTitle, updatedTitle)
	.replace(siteDescription, updatedDescription)
	.replace('#13579b', '#2468ac');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search', exact: true });
const notice = (page: Page) => page.getByText('Updates available', { exact: true });
let server: TestServer;

test.beforeEach(async () => {
	server = await startServer({ configuration: initialConfiguration });
	await server.ready();
});

test.afterEach(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
	expect(server.outputTruncated()).toBe(false);
	for (const value of [...privateSentinels, logoPath, server.path]) {
		expect(server.output()).not.toContain(value);
	}
});

async function signIn(page: Page, javaScriptEnabled = true) {
	const firstCheck = javaScriptEnabled ? page.waitForResponse('**/config/version') : undefined;
	await page.goto(`${server.url}/signin`);
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: siteTitle, exact: true })).toBeVisible();
	if (firstCheck) {
		await (await firstCheck).finished();
		await page.evaluate(() => document.readyState);
	}
}

async function readVersion(
	request: APIRequestContext,
	accept = 'application/json'
): Promise<string> {
	const response = await request.get(`${server.url}/config/version`, {
		maxRedirects: 0,
		headers: { accept }
	});
	expect(response.status()).toBe(200);
	expect(response.headers()['cache-control']).toBe('private, no-store');
	expect(response.headers()['content-type']).toContain('application/json');
	const text = await response.text();
	const value: unknown = JSON.parse(text);
	expect(value).toEqual({ snapshotId: expect.stringMatching(uuid) });
	return (value as { snapshotId: string }).snapshotId;
}

async function pauseClock(page: Page) {
	// Only browser timers are controlled; the disposable server's file watcher stays real.
	await page.clock.install();
	await page.clock.pauseAt(new Date(Date.now() + 1_000));
}

async function navigatePausedQuery(page: Page, href: string) {
	await page.evaluate((destination) => {
		const anchor = document.createElement('a');
		anchor.href = destination;
		anchor.textContent = 'Test native query navigation';
		anchor.id = 'test-native-query';
		(document.querySelector('[role="dialog"]') ?? document.body).append(anchor);
	}, href);
	await page.locator('#test-native-query').click();
	// Kit defers native link navigation until rAF + a timer, with a 100 ms fallback.
	await page.clock.runFor(100);
	await expect(page).toHaveURL(new URL(href, page.url()).href);
	await page
		.locator('#test-native-query')
		.evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
}

test('version is private and opaque; only accepted changes advance the real watched revision', async ({
	browser
}) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		for (const accept of ['application/json', 'text/html']) {
			const response = await server.fetch('/config/version', { headers: { accept } });
			expect(response.status).toBe(401);
			expect(response.headers.get('location')).toBeNull();
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			const text = await response.text();
			for (const value of [...privateSentinels, siteTitle, logoPath]) {
				expect(text).not.toContain(value);
			}
		}
		const page = await context.newPage();
		await signIn(page, false);
		expect((await context.cookies()).some((cookie) => /session-token$/.test(cookie.name))).toBe(
			true
		);
		const original = await readVersion(context.request);
		expect(await readVersion(context.request, 'text/html')).toBe(original);

		await server.replace(
			`# An editor changed formatting, not values.\n${initialConfiguration.replace(
				'    tags: [PRIVATE_C6_TAG]',
				'    tags:\n      - PRIVATE_C6_TAG'
			)}`
		);
		// A stable response alone could precede the one-second Node file poll.
		await delay(1_500);
		expect(await readVersion(context.request)).toBe(original);

		await server.replace('site: [PRIVATE_INVALID_UPDATE_YAML\n');
		await expect.poll(() => server.output(), { timeout: 5_000 }).toContain('load_failed');
		expect(await readVersion(context.request)).toBe(original);

		await server.replace(
			updatedConfiguration.replace(password, 'PRIVATE_REJECTED_UPDATE_PASSWORD')
		);
		await expect.poll(() => server.output(), { timeout: 5_000 }).toContain('restart_required');
		expect(await readVersion(context.request)).toBe(original);
		await expect(page).toHaveTitle(siteTitle);

		// replace() atomically renames an owned YAML file; acceptance is observed over HTTP.
		await server.replace(updatedConfiguration);
		await expect.poll(() => readVersion(context.request), { timeout: 5_000 }).not.toBe(original);
		for (const value of ['PRIVATE_INVALID_UPDATE_YAML', 'PRIVATE_REJECTED_UPDATE_PASSWORD']) {
			expect(server.output()).not.toContain(value);
		}
	} finally {
		await context.close();
	}
});

test('an accepted edit leaves the current document and typed URL alone until native Refresh', async ({
	page
}) => {
	// Capture native navigation entries before the clock replaces the Performance API.
	await page.context().addInitScript(() => {
		const getEntries = performance.getEntriesByType.bind(performance);
		Object.defineProperty(window, 'updateNavigationType', {
			get: () => (getEntries('navigation')[0] as PerformanceNavigationTiming | undefined)?.type
		});
	});
	await pauseClock(page);
	await page.emulateMedia({ colorScheme: 'light' });
	const versionRequests: string[] = [];
	const imageRequests: string[] = [];
	page.on('request', (request) => {
		const path = new URL(request.url()).pathname;
		if (path === '/config/version') versionRequests.push(request.url());
		if (path === logoPath) imageRequests.push(request.url());
	});
	await signIn(page);
	await expect(search(page)).toBeEnabled();
	await expect.poll(() => versionRequests.length).toBe(1);
	const original = await readVersion(page.request);
	await expect(page.locator('header img')).toHaveAttribute('src', '/favicon.png');
	await expect.poll(() => imageRequests.length).toBe(1);
	await page.evaluate(() => {
		document.body.dataset.updateDocument = 'original';
	});
	await search(page).fill('tag:PRIVATE_C6_TAG');
	const address = `${server.url}/?${new URLSearchParams({ q: 'tag:PRIVATE_C6_TAG' })}`;
	await expect(page).toHaveURL(address);
	await expect(page.locator('.tile-title')).toHaveText(['PRIVATE_C6_SERVICE']);
	await expect(search(page)).toBeFocused();
	await expect(search(page).locator('..')).toHaveCSS('outline-color', 'rgb(19, 87, 155)');

	await writeFile(
		join(dirname(server.path), 'public', 'config-update.svg'),
		'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><path fill="#2468ac" d="M0 0h48v48H0z"/></svg>'
	);
	await server.replace(updatedConfiguration);
	await expect.poll(() => readVersion(page.request), { timeout: 5_000 }).not.toBe(original);
	await page.clock.runFor(5_000);
	await expect(notice(page)).toBeVisible();
	await expect(notice(page)).toHaveCount(1);
	await expect(page).toHaveTitle(siteTitle);
	await expect(page.locator('meta[name="description"]')).toHaveAttribute(
		'content',
		siteDescription
	);
	await expect(search(page)).toHaveValue('tag:PRIVATE_C6_TAG');
	await expect(search(page)).toBeFocused();
	await expect(search(page).locator('..')).toHaveCSS('outline-color', 'rgb(19, 87, 155)');
	await expect(page.locator('body')).toHaveAttribute('data-update-document', 'original');
	await expect(page.locator('header img')).toHaveAttribute('src', '/favicon.png');
	expect(imageRequests).toHaveLength(1);
	await expect(page).toHaveURL(address);
	const checksAtNotice = versionRequests.length;
	await page.clock.runFor(60_000);
	expect(versionRequests).toHaveLength(checksAtNotice);

	const refresh = page.getByRole('link', { name: 'Refresh page', exact: true });
	await expect(refresh).toHaveAttribute('href', address);
	await expect(refresh).toHaveAttribute('data-sveltekit-reload', '');
	await expect(refresh).toHaveJSProperty('href', address);

	// Shallow query edits after the notice must update the native Refresh destination.
	const refreshedQuery = 'tag:PRIVATE_C6_TAG ';
	const refreshedAddress = `${server.url}/?${new URLSearchParams({ q: refreshedQuery })}`;
	await search(page).fill(refreshedQuery);
	await expect(page).toHaveURL(refreshedAddress);
	await expect(search(page)).toHaveValue(refreshedQuery);
	await expect(search(page)).toBeFocused();
	await expect(page.locator('.tile-title')).toHaveText(['PRIVATE_C6_SERVICE']);
	await expect(notice(page)).toHaveCount(1);
	await expect(page).toHaveTitle(siteTitle);
	await expect(page.locator('body')).toHaveAttribute('data-update-document', 'original');
	await expect(refresh).toHaveAttribute('href', refreshedAddress);
	await expect(refresh).toHaveJSProperty('href', refreshedAddress);
	expect(versionRequests).toHaveLength(checksAtNotice);
	await expect(page.locator('.update-notice')).toHaveCSS('position', 'sticky');
	await Promise.all([page.waitForEvent('domcontentloaded'), refresh.click()]);
	await expect(page).toHaveURL(refreshedAddress);
	await expect(page).toHaveTitle(updatedTitle);
	await expect(page.locator('meta[name="description"]')).toHaveAttribute(
		'content',
		updatedDescription
	);
	await expect(page.locator('body')).not.toHaveAttribute('data-update-document');
	expect(
		await page.evaluate(
			() => (window as Window & { updateNavigationType?: string }).updateNavigationType
		)
	).toBe('navigate');
	await expect(search(page)).toHaveValue(refreshedQuery);
	await expect(page.locator('.tile-title')).toHaveText(['PRIVATE_C6_SERVICE']);
	await search(page).click();
	await expect(search(page).locator('..')).toHaveCSS('outline-color', 'rgb(36, 104, 172)');
	await expect(page.locator('header img')).toHaveAttribute('src', logoPath);
	await expect(page.locator('header img')).toHaveJSProperty('naturalWidth', 48);
	await expect.poll(() => imageRequests.length).toBe(2);
	await expect(notice(page)).toHaveCount(0);
	const storage = await page.evaluate(() =>
		JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])
	);
	for (const value of [...privateSentinels, original, logoPath])
		expect(storage).not.toContain(value);
});

test('real SPA data changes do not forget the document baseline or steal dialog focus', async ({
	page
}) => {
	await pauseClock(page);
	await signIn(page);
	await expect(search(page)).toBeEnabled();
	const original = await readVersion(page.request);
	let latest = original;
	let checks = 0;
	await page.route('**/config/version', async (route) => {
		checks++;
		await route.fulfill({ json: { snapshotId: latest } });
	});
	await page.evaluate(() => {
		document.body.dataset.updateDocument = 'original';
	});
	await server.replace(updatedConfiguration);
	await expect.poll(() => readVersion(page.request), { timeout: 5_000 }).not.toBe(original);
	latest = await readVersion(page.request);
	await navigatePausedQuery(page, '/?link=household');
	await expect(page).toHaveTitle(updatedTitle);
	await expect(page.locator('body')).toHaveAttribute('data-update-document', 'original');
	const action = page.getByRole('dialog').getByRole('link', { name: /^Open / });
	await expect(action).toBeFocused();
	await page.clock.runFor(5_000);
	await expect(notice(page)).toHaveCount(1);
	await expect(action).toBeFocused();
	await expect(page.locator('.update-notice')).toHaveCSS('z-index', '5');
	await expect(page.locator('[data-dialog-overlay]')).toHaveCSS('z-index', '10');
	const stoppedAt = checks;
	await page.clock.runFor(60_000);
	await page.evaluate(() => {
		window.dispatchEvent(new Event('focus'));
		window.dispatchEvent(new Event('online'));
		document.dispatchEvent(new Event('visibilitychange'));
	});
	expect(checks).toBe(stoppedAt);
	await expect(page).toHaveURL(`${server.url}/?link=household`);
});

test('pending checks never overlap and abort on offline, hidden and SPA error cleanup', async ({
	page,
	context
}) => {
	type ObservedFetch = {
		signal: AbortSignal | null;
		outcome: 'pending' | 'fulfilled' | 'rejected';
		rejectionName?: string;
	};
	await page.addInitScript(() => {
		const observations: ObservedFetch[] = [];
		Object.defineProperty(window, 'updateVersionFetches', { value: observations });
		const nativeFetch = window.fetch;
		window.fetch = function (input, init) {
			const promise = nativeFetch.call(this, input, init);
			const url = input instanceof Request ? input.url : String(input);
			if (new URL(url, location.href).pathname === '/config/version') {
				const observation: ObservedFetch = {
					signal: init?.signal ?? (input instanceof Request ? input.signal : null),
					outcome: 'pending'
				};
				observations.push(observation);
				void promise.then(
					() => {
						observation.outcome = 'fulfilled';
					},
					(error: unknown) => {
						observation.outcome = 'rejected';
						if (error instanceof DOMException) observation.rejectionName = error.name;
					}
				);
			}
			// Observe the native promise without replacing it or changing fetch behavior.
			return promise;
		};
	});
	const fetchObservations = () =>
		page.evaluate(() =>
			(window as Window & { updateVersionFetches?: ObservedFetch[] }).updateVersionFetches!.map(
				({ signal, outcome, rejectionName }) => ({
					aborted: signal?.aborted,
					abortReasonName: signal?.reason instanceof DOMException ? signal.reason.name : undefined,
					outcome,
					rejectionName
				})
			)
		);
	async function expectAbortedCheck(index: number) {
		// Intercepted Chromium requests need not emit CDP requestfailed after cancellation.
		await expect
			.poll(async () => (await fetchObservations())[index])
			.toEqual({
				aborted: true,
				abortReasonName: 'AbortError',
				outcome: 'rejected',
				rejectionName: 'AbortError'
			});
	}
	await pauseClock(page);
	await signIn(page);
	await expect(search(page)).toBeEnabled();
	await expect
		.poll(fetchObservations)
		.toEqual([
			{ aborted: false, abortReasonName: undefined, outcome: 'fulfilled', rejectionName: undefined }
		]);
	const baseline = (await fetchObservations()).length;
	let checks = 0;
	const pending: Route[] = [];
	// Release each intercepted response only after the event that must abort its fetch.
	await page.route('**/config/version', (route) => {
		checks++;
		pending.push(route);
	});
	await page.clock.runFor(5_000);
	await expect.poll(() => checks).toBe(1);
	await page.evaluate(() => {
		for (let index = 0; index < 3; index++) window.dispatchEvent(new Event('focus'));
	});
	// Stay inside the real five-second request deadline so offline, not timeout, cancels it.
	await page.clock.runFor(4_999);
	expect(checks).toBe(1);
	expect(await fetchObservations()).toHaveLength(baseline + 1);
	expect((await fetchObservations())[baseline]).toEqual({
		aborted: false,
		abortReasonName: undefined,
		outcome: 'pending',
		rejectionName: undefined
	});

	const offlineCheck = pending[0]!;
	await context.setOffline(true);
	await expectAbortedCheck(baseline);
	await offlineCheck.fulfill({ json: { snapshotId: 'aborted-late-update' } });
	await expect(notice(page)).toHaveCount(0);
	expect(await page.evaluate(() => navigator.onLine)).toBe(false);
	await page.clock.runFor(60_000);
	expect(checks).toBe(1);
	expect(await fetchObservations()).toHaveLength(baseline + 1);
	await context.setOffline(false);
	expect(await page.evaluate(() => navigator.onLine)).toBe(true);
	await expect.poll(() => checks).toBe(2);

	const hiddenCheck = pending[1]!;
	// Headless window activation is platform-dependent; control the browser visibility signal.
	await page.evaluate(() => {
		Object.defineProperty(document, 'hidden', { configurable: true, value: true });
		document.dispatchEvent(new Event('visibilitychange'));
		window.dispatchEvent(new Event('focus'));
	});
	await expectAbortedCheck(baseline + 1);
	await hiddenCheck.fulfill({ json: { snapshotId: 'aborted-late-update' } });
	await expect(notice(page)).toHaveCount(0);
	await page.clock.runFor(60_000);
	expect(checks).toBe(2);
	expect(await fetchObservations()).toHaveLength(baseline + 2);
	await page.evaluate(() => {
		Object.defineProperty(document, 'hidden', { configurable: true, value: false });
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await expect.poll(() => checks).toBe(3);

	const cleanupCheck = pending[2]!;
	await navigatePausedQuery(page, '/?link=missing');
	await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();
	await expectAbortedCheck(baseline + 2);
	await cleanupCheck.fulfill({ json: { snapshotId: 'aborted-late-update' } });
	await page.evaluate(() => {
		window.dispatchEvent(new Event('focus'));
		window.dispatchEvent(new Event('online'));
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await page.clock.runFor(60_000);
	expect(checks).toBe(3);
	expect(await fetchObservations()).toHaveLength(baseline + 3);
	await expect(notice(page)).toHaveCount(0);
});

test('transient failures back off to sixty seconds and a healthy response restores five seconds', async ({
	page
}) => {
	await pauseClock(page);
	await signIn(page);
	await expect(search(page)).toBeEnabled();
	const original = await readVersion(page.request);
	let checks = 0;
	await page.route('**/config/version', async (route) => {
		checks++;
		if (checks === 2) await route.fulfill({ json: {} });
		else if (checks <= 5) await route.fulfill({ status: 503, body: 'Unavailable' });
		else await route.fulfill({ json: { snapshotId: original } });
	});
	async function completeCheck(milliseconds: number, count: number) {
		const response = page.waitForResponse('**/config/version');
		await page.clock.runFor(milliseconds);
		await (await response).finished();
		await expect.poll(() => checks).toBe(count);
		// Let the fetch continuation schedule its next browser timer before advancing it.
		await page.evaluate(() => document.readyState);
	}
	await completeCheck(5_000, 1);
	for (const [index, interval] of [10_000, 20_000, 40_000, 60_000, 60_000].entries()) {
		await page.clock.runFor(interval - 1);
		expect(checks).toBe(index + 1);
		await completeCheck(1, index + 2);
	}
	await page.clock.runFor(4_999);
	expect(checks).toBe(6);
	await completeCheck(1, 7);
	await expect(notice(page)).toHaveCount(0);
	await expect(page).toHaveTitle(siteTitle);
});

for (const status of [401, 403]) {
	test(`${status} stops quietly, and sign-in never polls without private directory data`, async ({
		page,
		context
	}) => {
		await pauseClock(page);
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await signIn(page);
		await expect(search(page)).toBeEnabled();
		await search(page).fill('PRIVATE_C6_SERVICE');
		let checks = 0;
		await page.route('**/config/version', async (route) => {
			checks++;
			await route.fulfill({ status, contentType: 'text/plain', body: 'Access denied' });
		});
		const denied = page.waitForResponse('**/config/version');
		await page.clock.runFor(5_000);
		const response = await denied;
		expect(response.status()).toBe(status);
		expect(response.headers()['content-type']).toContain('text/plain');
		// Auth denial intentionally aborts the body; only the response headers must complete.
		await page.evaluate(() => document.readyState);
		await page.clock.runFor(120_000);
		await page.evaluate(() => {
			window.dispatchEvent(new Event('focus'));
			window.dispatchEvent(new Event('online'));
			document.dispatchEvent(new Event('visibilitychange'));
		});
		expect(checks).toBe(1);
		await expect(notice(page)).toHaveCount(0);
		await expect(search(page)).toBeFocused();
		await expect(page).toHaveTitle(siteTitle);
		await expect(page).toHaveURL(`${server.url}/?q=PRIVATE_C6_SERVICE`);
		await context.clearCookies();
		await page.goto(`${server.url}/signin`);
		await expect(page.getByLabel('Username')).toBeVisible();
		await page.clock.runFor(30_000);
		expect(checks).toBe(1);
		await expect(notice(page)).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}

test('without JavaScript there is no polling or notice; a manual reload adopts accepted edits', async ({
	browser
}) => {
	const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'light' });
	try {
		const page = await context.newPage();
		const requests: string[] = [];
		page.on('request', (request) => {
			if (new URL(request.url()).pathname === '/config/version') requests.push(request.url());
		});
		await signIn(page, false);
		await expect(search(page)).toBeDisabled();
		const original = await readVersion(context.request);
		await server.replace(updatedConfiguration);
		await expect.poll(() => readVersion(context.request), { timeout: 5_000 }).not.toBe(original);
		// Observe more than one browser polling interval with scripting genuinely disabled.
		await delay(5_500);
		expect(requests).toEqual([]);
		await expect(notice(page)).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Refresh page', exact: true })).toHaveCount(0);
		await expect(page).toHaveTitle(siteTitle);
		await page.reload();
		await expect(page).toHaveTitle(updatedTitle);
		await expect(page.locator('meta[name="description"]')).toHaveAttribute(
			'content',
			updatedDescription
		);
		await expect(search(page)).toBeDisabled();
		expect(requests).toEqual([]);
	} finally {
		await context.close();
	}
});
