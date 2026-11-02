import { expect, test, type Page } from '@playwright/test';
import {
	clientId,
	clientSecret,
	configuration,
	credentialsAuth,
	oidcAuth,
	password,
	privateSentinels,
	siteDescription,
	siteTitle,
	username
} from './support/configuration.js';
import { startIssuer } from './support/oidc-issuer.js';
import { randomSecret, startServer, type TestServer } from './support/server.js';
import { responseCookieHeader } from './support/session.js';

test.setTimeout(60_000);

const hostileLegacyEnvironment = {
	ORIGIN: 'https://legacy-origin.example.test',
	AUTH_URL: 'https://legacy-auth.example.test',
	AUTH_SECRET: 'PRIVATE_C6_IGNORED_LEGACY_SECRET_0123456789',
	AUTH_TRUST_HOST: 'true',
	HOST_HEADER: 'x-forwarded-host',
	PROTOCOL_HEADER: 'x-forwarded-proto',
	PORT_HEADER: 'x-forwarded-port'
};

function expectPublic(text: string, extra: string[] = []) {
	for (const value of [...privateSentinels, ...extra]) expect(text).not.toContain(value);
}

function expectSafeLogs(server: TestServer, extra: string[] = []) {
	expect(server.outputTruncated()).toBe(false);
	expectPublic(server.output(), [
		server.path,
		...(server.secret ? [server.secret] : []),
		hostileLegacyEnvironment.AUTH_SECRET,
		...extra
	]);
}

function expectLocalLocation(response: Response, server: TestServer): URL {
	const location = response.headers.get('location');
	expect(location).not.toBeNull();
	const target = new URL(location!, server.origin);
	expect(target.origin).toBe(server.origin);
	expect(target.pathname.startsWith('//')).toBe(false);
	expect(target.username).toBe('');
	expect(target.password).toBe('');
	return target;
}

async function expectUnauthorized(response: Response) {
	expect(response.status, response.url).toBe(401);
	expect(response.headers.get('cache-control')).toContain('no-store');
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	expectPublic(await response.text());
}

async function postCredentials(
	server: TestServer,
	fields: Record<string, string> = { username, password, redirectTo: '/' }
) {
	return server.fetch('/signin', {
		method: 'POST',
		headers: { accept: 'text/html', origin: server.origin },
		body: new URLSearchParams(fields)
	});
}

async function signIn(page: Page, server: TestServer) {
	await page.goto(`${server.url}/signin`);
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

test('enabled authentication gates HTML, Kit data, HEAD and generated images without leaking private data', async () => {
	const server = await startServer({ configuration: configuration() });
	try {
		await server.ready();
		const navigation = await server.fetch('/?view=family', { headers: { accept: 'text/html' } });
		expect(navigation.status).toBe(303);
		const destination = expectLocalLocation(navigation, server);
		expect(destination.pathname).toBe('/signin');
		expect(destination.searchParams.get('callbackUrl')).toBe('/?view=family');
		expectPublic(await navigation.text());

		for (const pathname of [
			'/',
			'/__data.json?x-sveltekit-invalidated=11',
			'/unknown',
			'/bookmarks/household/logo'
		]) {
			await expectUnauthorized(
				await server.fetch(pathname, { headers: { accept: 'application/json' } })
			);
		}
		await expectUnauthorized(
			await server.fetch('/', { method: 'HEAD', headers: { accept: 'text/html' } })
		);

		for (const pathname of ['/signin', '/signin/__data.json?x-sveltekit-invalidated=11']) {
			const signin = await server.fetch(pathname);
			expect(signin.status).toBe(200);
			expect(signin.headers.get('cache-control')).toContain('no-store');
			expectPublic(await signin.text());
		}
		const health = await server.fetch('/healthz');
		expect(health.status).toBe(200);
		expect(await health.json()).toEqual({ status: 'ok' });
		const favicon = await server.fetch('/favicon.png');
		expect(favicon.status).toBe(200);
		expect(favicon.headers.get('content-type')).toContain('image/png');
		expectSafeLogs(server);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('native credentials reject a wrong password, sign in and sign out without JavaScript', async ({
	browser
}) => {
	const secret = randomSecret();
	const server = await startServer({
		configuration: configuration(),
		secret,
		env: hostileLegacyEnvironment
	});
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		await server.ready();
		const page = await context.newPage();
		await page.goto(server.url);
		await expect(page).toHaveURL(`${server.url}/signin?callbackUrl=%2F`);
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill('wrong-password');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByRole('alert')).toBeVisible();
		expectPublic(await page.getByRole('alert').innerText());
		const rejected = await context.request.get(`${server.url}/__data.json`, { maxRedirects: 0 });
		expect(rejected.status()).toBe(401);
		expectPublic(await rejected.text());

		await signIn(page, server);
		await expect(page.getByText('PRIVATE_C6_SERVICE', { exact: true })).toBeVisible();
		const cookies = await context.cookies(server.url);
		expect(cookies.length).toBeGreaterThan(0);
		const data = await context.request.get(`${server.url}/__data.json?x-sveltekit-invalidated=11`);
		expect(data.status()).toBe(200);
		const payload = await data.text();
		expect(payload).toContain(siteDescription);
		for (const value of [username, password, secret, ...cookies.map((cookie) => cookie.value)]) {
			expect(payload).not.toContain(value);
		}
		expect(await page.content()).not.toContain(secret);
		await page.goto(`${server.url}/signin?callbackUrl=${encodeURIComponent('/?returned=yes')}`);
		await expect(page).toHaveURL(`${server.url}/?returned=yes`);

		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page).toHaveURL((url) => url.origin === server.url && url.pathname === '/signin');
		const denied = await context.request.get(`${server.url}/__data.json`, { maxRedirects: 0 });
		expect(denied.status()).toBe(401);
		expectPublic(await denied.text());
		expectSafeLogs(
			server,
			cookies.map((cookie) => cookie.value)
		);
	} finally {
		await context.close();
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('auth and site.url edits reject the entire snapshot; display reloads preserve the running session and provider', async () => {
	const server = await startServer({ configuration: configuration() });
	try {
		await server.ready();
		const cookie = responseCookieHeader(await postCredentials(server));
		expect(cookie).not.toBe('');
		const readSnapshot = async () => {
			const response = await server.fetch('/config/version', { headers: { cookie } });
			expect(response.status).toBe(200);
			return response.json();
		};
		const snapshot = await readSnapshot();
		for (const rejected of [
			configuration(
				credentialsAuth.replace(password, 'PRIVATE_C6_REJECTED_PASSWORD'),
				'Rejected title'
			),
			configuration(credentialsAuth, 'Rejected title').replace(
				'${TEST_ORIGIN}',
				'https://rejected.example.test'
			)
		]) {
			const rejections = server.output().match(/restart_required/g)?.length ?? 0;
			await server.replace(rejected);
			await expect
				.poll(() => server.output().match(/restart_required/g)?.length ?? 0, {
					timeout: 10_000,
					intervals: [100, 250, 500]
				})
				.toBeGreaterThan(rejections);
			expect(await readSnapshot()).toEqual(snapshot);
			const signin = await server.fetch('/signin');
			const html = await signin.text();
			expect(html).toContain(siteTitle);
			expect(html).not.toContain('Rejected title');
			const root = await server.fetch('/', { headers: { cookie } });
			expect(root.status).toBe(200);
			const rootHtml = await root.text();
			expect(rootHtml).toContain(siteTitle);
			expect(rootHtml).not.toContain('Rejected title');
			expect(rootHtml).not.toContain('rejected.example.test');
		}
		const oldProvider = await postCredentials(server);
		expect(oldProvider.status).toBe(303);
		expect(expectLocalLocation(oldProvider, server).pathname).toBe('/');
		const freshCookie = responseCookieHeader(oldProvider);
		expect((await server.fetch('/__data.json', { headers: { cookie: freshCookie } })).status).toBe(
			200
		);
		const rejectedProvider = await postCredentials(server, {
			username,
			password: 'PRIVATE_C6_REJECTED_PASSWORD'
		});
		expect(expectLocalLocation(rejectedProvider, server).pathname).toBe('/signin');

		await server.replace(configuration(credentialsAuth, 'Restored title'));
		await expect
			.poll(
				async () => {
					const response = await server.fetch('/__data.json', { headers: { cookie } });
					expect(response.status).toBe(200);
					return response.text();
				},
				{ timeout: 10_000, intervals: [100, 250, 500] }
			)
			.toContain('Restored title');
		expectSafeLogs(server, ['PRIVATE_C6_REJECTED_PASSWORD']);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('omitting auth keeps native pages and Kit data open without operator auth environment', async ({
	browser
}) => {
	const server = await startServer({ configuration: configuration('') });
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		await server.ready();
		const page = await context.newPage();
		await page.goto(server.url);
		await expect(page.getByText('PRIVATE_C6_SERVICE', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
		await page.goto(`${server.url}/signin`);
		await expect(page).toHaveURL(`${server.url}/`);
		const data = await server.fetch('/__data.json');
		expect(data.status).toBe(200);
		expect(await data.text()).toContain(siteDescription);
		expectSafeLogs(server);
	} finally {
		await context.close();
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('native OIDC login, GET callback and local logout work without JavaScript at the runtime origin', async ({
	browser
}) => {
	const issuer = await startIssuer();
	const server = await startServer({
		configuration: configuration(oidcAuth(issuer.origin)),
		env: hostileLegacyEnvironment
	});
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		issuer.allowCallback(server.origin);
		await server.ready();
		const publicData = await server.fetch('/signin/__data.json');
		expect(publicData.status).toBe(200);
		expectPublic(await publicData.text(), [issuer.origin]);

		const page = await context.newPage();
		await page.goto(`${server.url}/signin?callbackUrl=${encodeURIComponent('/?returned=oidc')}`);
		await page.getByRole('button', { name: 'Sign in with single sign-on' }).click();
		await expect(page).toHaveURL(`${server.url}/?returned=oidc`);
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
		await expect(page.getByText('PRIVATE_C6_SERVICE', { exact: true })).toBeVisible();

		const cookies = await context.cookies(server.url);
		expect(cookies.length).toBeGreaterThan(0);
		const data = await context.request.get(`${server.url}/__data.json`);
		expect(data.status()).toBe(200);
		const payload = await data.text();
		expect(payload).toContain(siteDescription);
		for (const value of [
			'PRIVATE_C6_IDENTITY',
			'private-c6@example.test',
			username,
			password,
			clientId,
			clientSecret,
			issuer.origin,
			...issuer.tokens,
			...cookies.map((cookie) => cookie.value)
		]) {
			expect(payload).not.toContain(value);
		}

		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page).toHaveURL((url) => url.origin === server.url && url.pathname === '/signin');
		const denied = await context.request.get(`${server.url}/__data.json`, { maxRedirects: 0 });
		expect(denied.status()).toBe(401);
		expectPublic(await denied.text());
		expect(issuer.violations).toEqual([]);
		expect(issuer.handlerErrors).toEqual([]);
		expectSafeLogs(server, [
			issuer.origin,
			...issuer.tokens,
			...cookies.map((cookie) => cookie.value)
		]);
	} finally {
		try {
			await context.close();
			expect(await server.stop()).toEqual({ code: 0, signal: null });
		} finally {
			await issuer.stop();
		}
	}
});
