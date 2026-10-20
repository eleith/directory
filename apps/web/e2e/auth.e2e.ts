import { expect, test, type Browser, type Page } from '@playwright/test';
import {
	clientId,
	clientSecret,
	configuration,
	credentialsAuth,
	oidcAuth,
	password,
	privateDescription,
	privateSentinels,
	siteTitle,
	username
} from './support/configuration.js';
import { startIssuer, type TestIssuer } from './support/oidc-issuer.js';
import { randomSecret, startServer, type TestServer } from './support/server.js';
import { expiredSession, readSession } from './support/session.js';

test.setTimeout(60_000);

function expectPublic(text: string, extra: string[] = []) {
	for (const value of [...privateSentinels, ...extra]) expect(text).not.toContain(value);
}

function expectSafeLogs(server: TestServer, extra: string[] = []) {
	expect(server.outputTruncated()).toBe(false);
	expectPublic(server.output(), [server.path, ...(server.secret ? [server.secret] : []), ...extra]);
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
	fields: Record<string, string> = { username, password, redirectTo: '/' },
	headers: Record<string, string> = {}
) {
	return server.fetch('/signin', {
		method: 'POST',
		headers: { accept: 'text/html', origin: server.origin, ...headers },
		body: new URLSearchParams(fields)
	});
}

function sessionCookie(response: Response) {
	const header = response.headers.getSetCookie().find((value) => /session-token=/.test(value));
	expect(header, 'Successful SDK sign-in must issue a session cookie').toBeDefined();
	const pair = header!.split(';')[0]!;
	const separator = pair.indexOf('=');
	return {
		header: header!,
		pair,
		name: pair.slice(0, separator),
		value: pair.slice(separator + 1)
	};
}

async function signIn(page: Page, server: TestServer) {
	await page.goto(`${server.url}/signin`);
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
	await expect(page.getByRole('heading', { name: siteTitle, exact: true })).toBeVisible();
}

async function oidcRoundTrip(browser: Browser, server: TestServer, succeeds: boolean) {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(`${server.url}/signin`);
		await page.getByRole('button', { name: 'Sign in with single sign-on' }).click();
		if (succeeds) {
			await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
			await expect(page.getByRole('heading', { name: siteTitle, exact: true })).toBeVisible();
		} else {
			await expect(page).toHaveURL(
				(url) => url.origin === server.url && url.pathname === '/signin'
			);
			await expect(page.getByRole('alert')).toContainText('Unable to sign in');
			const response = await context.request.get(`${server.url}/__data.json`, { maxRedirects: 0 });
			expect(response.status()).toBe(401);
			expectPublic(await response.text());
		}
		return await context.cookies();
	} finally {
		await context.close();
	}
}

function expectIssuerHealthy(issuer: TestIssuer) {
	expect(issuer.violations).toEqual([]);
	expect(issuer.handlerErrors).toEqual([]);
}

async function stopOidc(server: TestServer, issuer: TestIssuer) {
	try {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	} finally {
		await issuer.stop();
	}
}

test('enabled authentication gates HTML, actual Kit data, HEAD, unknown routes and future assets', async () => {
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
			'/public/private.svg',
			'/healthz/extra',
			'/signin/extra',
			'/favicon-missing.svg'
		]) {
			await expectUnauthorized(
				await server.fetch(pathname, { headers: { accept: 'application/json' } })
			);
		}
		await expectUnauthorized(
			await server.fetch('/', { method: 'HEAD', headers: { accept: 'text/html' } })
		);
		await expectUnauthorized(
			await server.fetch('/', {
				method: 'POST',
				headers: { origin: server.origin },
				body: 'private request'
			})
		);

		const signin = await server.fetch('/signin');
		expect(signin.status).toBe(200);
		expect(signin.headers.get('cache-control')).toContain('no-store');
		expect(signin.headers.get('referrer-policy')).toBeTruthy();
		const html = await signin.text();
		expect(html).toContain(siteTitle);
		expectPublic(html);
		const signinData = await server.fetch('/signin/__data.json?x-sveltekit-invalidated=11');
		expect(signinData.status).toBe(200);
		expect(signinData.headers.get('content-type')).toContain('application/json');
		const data = await signinData.text();
		expect(data).toContain(siteTitle);
		expectPublic(data);
		expect(data).not.toContain('session');
		expect(data).not.toContain('authentication');

		const health = await server.fetch('/healthz');
		expect(health.status).toBe(200);
		expect(await health.json()).toEqual({ status: 'ok' });
		const headHealth = await server.fetch('/healthz', { method: 'HEAD' });
		expect(headHealth.status).toBe(200);
		expect(await headHealth.text()).toBe('');
		const scriptPath = html.match(/_app\/immutable\/[^"'\s]+\.js/)?.[0];
		expect(scriptPath).toBeDefined();
		for (const method of ['GET', 'HEAD']) {
			for (const [path, contentType] of [
				['/favicon.svg', 'image/svg+xml'],
				[`/${scriptPath!}`, 'javascript']
			] as const) {
				const asset = await server.fetch(path, { method });
				expect(asset.status).toBe(200);
				expect(asset.headers.get('content-type')).toContain(contentType);
				const body = await asset.text();
				if (method === 'HEAD') expect(body).toBe('');
				else expect(body.length).toBeGreaterThan(0);
				expectPublic(body);
			}
		}
		const missingScript = await server.fetch('/_app/immutable/missing.js');
		expect(missingScript.status).toBe(404);
		expectPublic(await missingScript.text());
		expectSafeLogs(server);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('native routes reject unsupported verbs instead of serving public or private content', async () => {
	const server = await startServer({ configuration: configuration() });
	try {
		await server.ready();
		for (const path of ['/signin', '/healthz']) {
			for (const method of ['PUT', 'PATCH', 'DELETE']) {
				const response = await server.fetch(path, {
					method,
					headers: { origin: server.origin }
				});
				expect(response.status).toBe(405);
				expectPublic(await response.text());
			}
		}
		const healthPost = await server.fetch('/healthz', {
			method: 'POST',
			headers: { origin: server.origin }
		});
		expect(healthPost.status).toBe(405);
		expectPublic(await healthPost.text());

		const cookie = sessionCookie(await postCredentials(server)).pair;
		for (const path of ['/', '/public/private.svg', '/bookmarks/photos/logo']) {
			for (const method of ['PUT', 'PATCH', 'DELETE']) {
				for (const session of ['', cookie]) {
					const response = await server.fetch(path, {
						method,
						headers: { origin: server.origin, cookie: session }
					});
					expect(response.status).toBe(session ? 405 : 401);
					expectPublic(await response.text());
				}
			}
		}
		expectSafeLogs(server);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('native SSR credentials and named root signout work without JavaScript', async ({
	browser
}) => {
	const server = await startServer({ configuration: configuration() });
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		await server.ready();
		const page = await context.newPage();
		await page.goto(server.url);
		await expect(page).toHaveURL(`${server.url}/signin?callbackUrl=%2F`);
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill('wrong-password');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByRole('alert')).toHaveText(
			/Invalid username or password|Unable to sign in/
		);
		expectPublic(await page.getByRole('alert').innerText());
		await signIn(page, server);
		await expect(page.getByText(privateDescription)).toBeVisible();
		const form = page.locator('form', { has: page.getByRole('button', { name: 'Sign out' }) });
		await expect(form).toHaveAttribute('method', 'POST');
		await expect(form).toHaveAttribute('action', '?/signout');

		const cookie = (await context.cookies()).find((value) => /session-token$/.test(value.name));
		expect(cookie).toBeDefined();
		expect(cookie!.httpOnly).toBe(true);
		expect(cookie!.secure).toBe(false);
		expect(cookie!.sameSite).toBe('Lax');
		expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(7 * 86_400 - 120);
		expect(cookie!.expires - Date.now() / 1000).toBeLessThanOrEqual(7 * 86_400 + 10);
		const jwt = await readSession(server.secret!, cookie!.name, cookie!.value);
		expect(jwt!.exp - jwt!.iat).toBe(7 * 86_400);

		const data = await context.request.get(`${server.url}/__data.json?x-sveltekit-invalidated=11`);
		expect(data.status()).toBe(200);
		const payload = await data.text();
		expect(payload).toContain(privateDescription);
		expect(payload).not.toContain(username);
		expect(payload).not.toContain(password);
		expect(payload).not.toContain(cookie!.value);
		expect(payload).not.toContain('roles');
		await page.goto(`${server.url}/signin?callbackUrl=${encodeURIComponent('/?returned=yes')}`);
		await expect(page).toHaveURL(`${server.url}/?returned=yes`);

		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page).toHaveURL((url) => url.origin === server.url && url.pathname === '/signin');
		const denied = await context.request.get(`${server.url}/__data.json`, { maxRedirects: 0 });
		expect(denied.status()).toBe(401);
		expectPublic(await denied.text());
		expect((await context.cookies()).filter((value) => /session-token$/.test(value.name))).toEqual(
			[]
		);
		expectSafeLogs(server);
	} finally {
		await context.close();
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('SDK rejects wrong, missing and non-string credentials and does not forward arbitrary action fields', async () => {
	const server = await startServer({ configuration: configuration() });
	try {
		await server.ready();
		for (const fields of [
			{ username: 'wrong-user', password },
			{ username, password: 'wrong-password' },
			{ username },
			{ password },
			{}
		]) {
			const response = await postCredentials(server, fields);
			expect(response.status).toBe(303);
			expect(expectLocalLocation(response, server).pathname).toBe('/signin');
			expect(response.headers.getSetCookie().some((cookie) => /session-token=/.test(cookie))).toBe(
				false
			);
			expectPublic(await response.text());
		}
		const malformed = new FormData();
		malformed.set('username', new Blob(['not-a-string']), 'username.txt');
		malformed.set('password', password);
		const response = await server.fetch('/signin', {
			method: 'POST',
			headers: { accept: 'text/html', origin: server.origin },
			body: malformed
		});
		expect(response.status).toBe(303);
		expect(expectLocalLocation(response, server).pathname).toBe('/signin');
		await expectUnauthorized(await server.fetch('/__data.json'));

		const allowed = await postCredentials(server, {
			username,
			password,
			redirectTo: '/?family=all',
			providerId: 'oidc',
			redirect: 'false',
			callbackUrl: 'https://foreign.example.test/PRIVATE_C6_EVIL',
			'authorizationParams-redirect_uri': 'https://foreign.example.test/PRIVATE_C6_EVIL',
			'authorizationParams-client_id': 'foreign-client'
		});
		expect([302, 303]).toContain(allowed.status);
		expect(expectLocalLocation(allowed, server).pathname).toBe('/');
		expect(expectLocalLocation(allowed, server).search).toBe('?family=all');
		const cookie = sessionCookie(allowed);
		const root = await server.fetch('/', { headers: { cookie: cookie.pair } });
		expect(root.status).toBe(200);
		const refreshed = sessionCookie(root);
		expect(refreshed.name).toBe(cookie.name);
		expect(refreshed.header).not.toMatch(/; Secure(?:;|$)/i);
		expect(await root.text()).toContain(privateDescription);
		expectSafeLogs(server, ['PRIVATE_C6_EVIL']);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('return paths and untrusted proxy headers cannot mint foreign redirects', async ({ page }) => {
	const server = await startServer({ configuration: configuration() });
	try {
		await server.ready();
		for (const callback of [
			'https://foreign.example.test/PRIVATE_C6_EVIL',
			'//foreign.example.test/PRIVATE_C6_EVIL',
			'/\\foreign.example.test/PRIVATE_C6_EVIL',
			'\\\\foreign.example.test/PRIVATE_C6_EVIL',
			'%2f%2fforeign.example.test/PRIVATE_C6_EVIL',
			'%5c%5cforeign.example.test/PRIVATE_C6_EVIL'
		]) {
			await page.goto(`${server.url}/signin?${new URLSearchParams({ callbackUrl: callback })}`);
			expectPublic(await page.content());
			const returnPath = await page.locator('input[name="redirectTo"]').inputValue();
			expect(new URL(returnPath, server.origin).origin).toBe(server.origin);
			const response = await postCredentials(server, { username, password, redirectTo: callback });
			expect([302, 303]).toContain(response.status);
			expectLocalLocation(response, server);
			const cookie = sessionCookie(response);
			const signout = await server.fetch('/?/signout', {
				method: 'POST',
				headers: { accept: 'text/html', origin: server.origin, cookie: cookie.pair },
				body: new URLSearchParams({ redirectTo: callback })
			});
			expect([302, 303]).toContain(signout.status);
			expectLocalLocation(signout, server);
		}
		const hostileHeaders = {
			host: 'foreign.example.test',
			'x-forwarded-host': 'foreign.example.test',
			'x-forwarded-proto': 'https',
			'x-forwarded-port': '443',
			forwarded: 'host=foreign.example.test;proto=https',
			'x-auth-return-redirect': '1'
		};
		const response = await postCredentials(
			server,
			{ username, password, redirectTo: '/' },
			hostileHeaders
		);
		expect([302, 303]).toContain(response.status);
		expectLocalLocation(response, server);
		for (const cookie of response.headers.getSetCookie())
			expect(cookie).not.toContain('foreign.example.test');
		const badOrigin = await postCredentials(
			server,
			{ username, password },
			{ origin: 'https://foreign.example.test' }
		);
		expect(badOrigin.status).toBe(403);
		expectPublic(await badOrigin.text());
		expectSafeLogs(server, ['PRIVATE_C6_EVIL', 'foreign.example.test']);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('raw auth APIs stay blocked and same-origin checks cover every POST content type', async () => {
	const server = await startServer({ configuration: configuration() });
	try {
		await server.ready();
		const cookie = sessionCookie(await postCredentials(server));
		for (const pathname of [
			'/auth/session',
			'/auth/providers',
			'/auth/signout',
			'/auth/callback/credentials',
			'/auth/callback/oidc'
		]) {
			for (const method of ['GET', 'POST']) {
				const response = await server.fetch(pathname, {
					method,
					headers: {
						origin: server.origin,
						cookie: cookie.pair,
						'content-type': 'application/json'
					},
					...(method === 'POST' ? { body: JSON.stringify({ username, password }) } : {})
				});
				expect([401, 404]).toContain(response.status);
				expectPublic(await response.text());
			}
		}
		for (const contentType of [
			'application/x-www-form-urlencoded',
			'text/plain',
			'application/json',
			'multipart/form-data; boundary=c6'
		]) {
			for (const pathname of [
				'/signin',
				'/?/signout',
				'/auth/signout',
				'/auth/session',
				'/auth/callback/credentials'
			]) {
				const response = await server.fetch(pathname, {
					method: 'POST',
					headers: {
						origin: 'https://foreign.example.test',
						cookie: cookie.pair,
						'content-type': contentType
					},
					body: 'username=foreign&password=foreign'
				});
				expect(response.status).toBe(403);
				expectPublic(await response.text());
			}
		}
		const missingOrigin = await server.fetch('/signin', {
			method: 'POST',
			body: new URLSearchParams({ username, password })
		});
		expect(missingOrigin.status).toBe(403);
		const stillSignedIn = await server.fetch('/__data.json', { headers: { cookie: cookie.pair } });
		expect(stillSignedIn.status).toBe(200);
		expectSafeLogs(server);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('HTTPS origin sets Secure SDK cookies even when the trusted upstream transport is HTTP', async () => {
	const server = await startServer({
		configuration: configuration(),
		origin: 'https://directory.example.test'
	});
	try {
		await server.ready();
		const response = await postCredentials(server);
		expect([302, 303]).toContain(response.status);
		expectLocalLocation(response, server);
		const cookie = sessionCookie(response);
		expect(cookie.name).toBe('__Secure-authjs.session-token');
		expect(cookie.header).toMatch(/; Secure(?:;|$)/i);
		expect(cookie.header).toMatch(/; HttpOnly(?:;|$)/i);
		expect(cookie.header).toMatch(/; SameSite=Lax(?:;|$)/i);
		const root = await server.fetch('/__data.json', { headers: { cookie: cookie.pair } });
		expect(root.status).toBe(200);
		const refreshed = sessionCookie(root);
		expect(refreshed.name).toBe(cookie.name);
		expect(refreshed.header).toMatch(/; Secure(?:;|$)/i);
		expectSafeLogs(server);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('tamper, expiry and secret rotation deny sessions while same-secret restart preserves real JWTs', async () => {
	const secret = randomSecret();
	let server = await startServer({ configuration: configuration(), secret });
	try {
		await server.ready();
		const cookie = sessionCookie(await postCredentials(server));
		const parts = cookie.value.split('.');
		parts[3] = `${parts[3]![0] === 'a' ? 'b' : 'a'}${parts[3]!.slice(1)}`;
		await expectUnauthorized(
			await server.fetch('/__data.json', {
				headers: { cookie: `${cookie.name}=${parts.join('.')}` }
			})
		);
		const expired = await expiredSession(secret, cookie.name);
		await expectUnauthorized(
			await server.fetch('/__data.json', {
				headers: { cookie: `${cookie.name}=${expired}` }
			})
		);
		expectSafeLogs(server, [cookie.value, expired]);
		const { port, origin } = server;
		expect(await server.stop()).toEqual({ code: 0, signal: null });

		server = await startServer({ configuration: configuration(), secret, port, origin });
		await server.ready();
		const preserved = await server.fetch('/__data.json', { headers: { cookie: cookie.pair } });
		expect(preserved.status).toBe(200);
		expect(await preserved.text()).toContain(privateDescription);
		expectSafeLogs(server, [cookie.value]);
		expect(await server.stop()).toEqual({ code: 0, signal: null });

		server = await startServer({
			configuration: configuration(),
			secret: randomSecret(),
			port,
			origin
		});
		await server.ready();
		await expectUnauthorized(
			await server.fetch('/__data.json', { headers: { cookie: cookie.pair } })
		);
		expectSafeLogs(server, [cookie.value]);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('auth edits reject the entire reload; restoring auth allows display updates and old providers keep working', async () => {
	const server = await startServer({ configuration: configuration() });
	try {
		await server.ready();
		const cookie = sessionCookie(await postCredentials(server));
		await server.replace(
			configuration(
				credentialsAuth.replace(password, 'PRIVATE_C6_REJECTED_PASSWORD'),
				'Rejected title'
			)
		);
		await expect
			.poll(() => server.output(), { timeout: 10_000, intervals: [100, 250, 500] })
			.toContain('restart_required');
		const signin = await server.fetch('/signin');
		const html = await signin.text();
		expect(html).toContain(siteTitle);
		expect(html).not.toContain('Rejected title');
		const oldProvider = await postCredentials(server);
		expect([302, 303]).toContain(oldProvider.status);
		expect(expectLocalLocation(oldProvider, server).pathname).toBe('/');
		sessionCookie(oldProvider);
		const rejectedProvider = await postCredentials(server, {
			username,
			password: 'PRIVATE_C6_REJECTED_PASSWORD'
		});
		expect(expectLocalLocation(rejectedProvider, server).pathname).toBe('/signin');

		await server.replace(configuration(credentialsAuth, 'Restored title'));
		await expect
			.poll(
				async () => {
					const response = await server.fetch('/__data.json', { headers: { cookie: cookie.pair } });
					return response.text();
				},
				{ timeout: 10_000, intervals: [100, 250, 500] }
			)
			.toContain('Restored title');
		const root = await server.fetch('/', { headers: { cookie: cookie.pair } });
		expect(root.status).toBe(200);
		expect(await root.text()).toContain('Restored title');
		expectSafeLogs(server, ['PRIVATE_C6_REJECTED_PASSWORD']);
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('omitting auth needs no AUTH_SECRET, ORIGIN or AUTH_URL and exposes no signout control', async ({
	browser
}) => {
	const server = await startServer({
		configuration: configuration(''),
		secret: null,
		origin: null
	});
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		await server.ready();
		const page = await context.newPage();
		await page.goto(server.url);
		await expect(page.getByRole('heading', { name: siteTitle, exact: true })).toBeVisible();
		await expect(page.getByText(privateDescription)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
		await page.goto(`${server.url}/signin`);
		await expect(page).toHaveURL(`${server.url}/`);
		const data = await server.fetch('/__data.json');
		expect(data.status).toBe(200);
		expect(await data.text()).toContain(privateDescription);
		expectSafeLogs(server);
	} finally {
		await context.close();
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});

test('real OIDC discovery and browser roundtrip use PKCE, state and nonce and the same Directory session', async ({
	browser
}) => {
	const issuer = await startIssuer();
	const server = await startServer({ configuration: configuration(oidcAuth(issuer.origin)) });
	try {
		issuer.allowCallback(server.origin);
		await server.ready();
		const publicData = await server.fetch('/signin/__data.json');
		expect(publicData.status).toBe(200);
		expectPublic(await publicData.text(), [issuer.origin]);
		const kickoff = await postCredentials(
			server,
			{
				providerId: 'credentials',
				redirectTo: '/',
				'authorizationParams-redirect_uri': 'https://foreign.example.test/PRIVATE_C6_EVIL',
				'authorizationParams-client_id': 'foreign-client',
				'authorizationParams-state': 'foreign-state',
				'authorizationParams-nonce': 'foreign-nonce',
				'authorizationParams-code_challenge': 'foreign-challenge'
			},
			{
				host: 'foreign.example.test',
				'x-forwarded-host': 'foreign.example.test',
				'x-forwarded-proto': 'https',
				'x-forwarded-port': '443',
				forwarded: 'host=foreign.example.test;proto=https',
				'x-auth-return-redirect': '1'
			}
		);
		expect([302, 303]).toContain(kickoff.status);
		const authorizationUrl = new URL(kickoff.headers.get('location')!);
		expect(authorizationUrl.origin).toBe(issuer.origin);
		expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
			`${server.origin}/auth/callback/oidc`
		);
		expect(authorizationUrl.searchParams.get('client_id')).not.toBe('foreign-client');
		expect(authorizationUrl.searchParams.get('state')).not.toBe('foreign-state');
		expect(authorizationUrl.searchParams.get('nonce')).not.toBe('foreign-nonce');
		expect(authorizationUrl.searchParams.get('code_challenge')).not.toBe('foreign-challenge');
		expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
		const cookies = await oidcRoundTrip(browser, server, true);
		expect(issuer.discoveryRequests()).toBeGreaterThanOrEqual(2);
		expect(issuer.authorizations).toHaveLength(1);
		expect(issuer.grants).toHaveLength(1);
		expect(issuer.authorizations[0]!.used).toBe(true);
		const cookie = cookies.find((value) => /session-token$/.test(value.name));
		expect(cookie).toBeDefined();
		const data = await server.fetch('/__data.json', {
			headers: { cookie: `${cookie!.name}=${cookie!.value}` }
		});
		expect(data.status).toBe(200);
		const payload = await data.text();
		expect(payload).toContain(siteTitle);
		expect(payload).toContain(privateDescription);
		expect(payload).not.toContain('PRIVATE_C6_IDENTITY');
		expect(payload).not.toContain('roles');
		for (const value of [
			username,
			password,
			clientId,
			clientSecret,
			issuer.origin,
			...issuer.tokens
		]) {
			expect(payload).not.toContain(value);
		}
		const replay = await server.fetch(
			`/auth/callback/oidc?${new URLSearchParams({
				code: issuer.authorizations[0]!.code,
				state: issuer.authorizations[0]!.state
			})}`
		);
		expect([302, 303]).toContain(replay.status);
		expectLocalLocation(replay, server);
		await expectUnauthorized(await server.fetch('/__data.json'));
		expect(issuer.grants).toHaveLength(1);
		expectIssuerHealthy(issuer);
		expectSafeLogs(server, [
			issuer.origin,
			...issuer.tokens,
			cookie!.value,
			'PRIVATE_C6_EVIL',
			'foreign.example.test'
		]);
	} finally {
		await stopOidc(server, issuer);
	}
});

test('OIDC rejects bad state before token exchange and rejects nonce, issuer, audience and invalid tokens', async ({
	browser
}) => {
	const issuer = await startIssuer();
	const server = await startServer({ configuration: configuration(oidcAuth(issuer.origin)) });
	try {
		issuer.allowCallback(server.origin);
		await server.ready();
		issuer.scenario('bad-state');
		await oidcRoundTrip(browser, server, false);
		expect(issuer.authorizations).toHaveLength(1);
		expect(issuer.tokenRequests()).toBe(0);
		for (const scenario of [
			'bad-nonce',
			'bad-issuer',
			'bad-audience',
			'malformed-token',
			'expired-token'
		] as const) {
			issuer.scenario(scenario);
			const previousGrants = issuer.grants.length;
			await oidcRoundTrip(browser, server, false);
			expect(issuer.grants.length, scenario).toBe(previousGrants + 1);
		}
		expectIssuerHealthy(issuer);
		expectSafeLogs(server, [issuer.origin, ...issuer.tokens]);
	} finally {
		await stopOidc(server, issuer);
	}
});

test('OIDC discovery and token outages fail closed and recovery does not weaken the checks', async ({
	browser
}) => {
	const issuer = await startIssuer();
	const server = await startServer({ configuration: configuration(oidcAuth(issuer.origin)) });
	try {
		issuer.allowCallback(server.origin);
		await server.ready();
		issuer.scenario('discovery-outage');
		await oidcRoundTrip(browser, server, false);
		expect(issuer.discoveryRequests()).toBeGreaterThan(0);
		expect(issuer.authorizations).toHaveLength(0);
		issuer.scenario('discovery-issuer');
		await oidcRoundTrip(browser, server, false);
		expect(issuer.authorizations).toHaveLength(0);
		issuer.scenario('token-outage');
		await oidcRoundTrip(browser, server, false);
		expect(issuer.grants).toHaveLength(1);
		issuer.scenario('normal');
		// Verify the pinned SDK keeps S256 when discovery omits its capability.
		issuer.advertiseS256(false);
		await oidcRoundTrip(browser, server, true);
		expect(issuer.authorizations).toHaveLength(2);
		expect(issuer.grants).toHaveLength(2);
		expectIssuerHealthy(issuer);
		expectSafeLogs(server, [issuer.origin, ...issuer.tokens, clientSecret]);
	} finally {
		await stopOidc(server, issuer);
	}
});
