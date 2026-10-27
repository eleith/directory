import { validateConfig } from '@directory/config';
import { describe, expect, it, vi } from 'vitest';
import type { Authentication } from '../../../lib/server/auth/index.js';
import { prepareSnapshot } from '../../../lib/server/directory/snapshot.js';
import { logger } from '../../../lib/server/logger.js';
import { actions, load } from './+page.server.js';

vi.mock('../../../lib/server/logger.js', () => ({ logger: { error: vi.fn() } }));

function eventFor(query = '', strategy: Authentication['strategy'] = 'credentials') {
	const snapshot = prepareSnapshot(
		validateConfig(
			{
				site: {
					title: 'Home Server',
					description: 'PRIVATE_DESCRIPTION',
					logo_path: '/public/private.svg'
				},
				auth: {
					origin: 'https://private-auth.example.test',
					secret: 'PRIVATE_SESSION_SECRET_AT_LEAST_32_CHARACTERS',
					credentials: { username: 'PRIVATE_USERNAME', password: 'PRIVATE_PASSWORD' }
				},
				links: { photos: { title: 'PRIVATE_LINK', url: 'https://photos.example.com' } }
			},
			{ env: {} }
		)
	);
	const authentication = {
		strategy,
		handle: vi.fn<Authentication['handle']>(),
		signIn: vi.fn<Authentication['signIn']>().mockResolvedValue(undefined),
		signOut: vi.fn<Authentication['signOut']>().mockResolvedValue(undefined)
	};
	const auth = vi.fn<App.Locals['auth']>().mockResolvedValue(null);
	const locals = { snapshot, authentication, auth, session: null } satisfies Partial<App.Locals>;
	const event = {
		locals,
		url: new URL(`/signin${query}`, 'https://directory.example'),
		request: new Request('https://directory.example/signin', { method: 'POST' })
	} as unknown as Parameters<typeof load>[0];
	return { event, authentication, auth };
}

async function expectRedirect(promise: Promise<unknown>, location: string) {
	await expect(promise).rejects.toMatchObject({ status: 303, location });
}

describe('sign-in page', () => {
	it.each(['credentials', 'oidc'] as const)(
		'exposes only the public sign-in fields for %s',
		async (strategy) => {
			const { event, auth } = eventFor('?callbackUrl=%2F%3Flink%3Dphotos', strategy);
			const data = await load(event);
			expect(auth).toHaveBeenCalledOnce();
			expect(data).toEqual({
				title: 'Home Server',
				strategy,
				callbackUrl: '/?link=photos',
				error: null
			});
		}
	);

	it('redirects no-auth mode to root without reading a session or snapshot', async () => {
		const { event, auth } = eventFor('?callbackUrl=%2Fother&error=PRIVATE_ERROR');
		event.locals.authentication = undefined;
		Object.defineProperty(event.locals, 'snapshot', {
			get() {
				throw new Error('No public data needed');
			}
		});
		await expectRedirect(load(event), '/');
		expect(auth).not.toHaveBeenCalled();
	});

	it('redirects a valid session to a safe return path without exposing it', async () => {
		const { event, auth } = eventFor('?callbackUrl=%2F%3Flink%3Dphotos%23details');
		auth.mockResolvedValue({ user: { name: 'PRIVATE_IDENTITY' }, expires: '2099-01-01' });
		await expectRedirect(load(event), '/?link=photos#details');
		expect(auth).toHaveBeenCalledOnce();
	});

	it('does not treat a session without a user as signed in', async () => {
		const { event, auth } = eventFor();
		auth.mockResolvedValue({ expires: '2099-01-01' });
		expect(await load(event)).toMatchObject({ strategy: 'credentials' });
	});

	it.each([
		'https://outside.example/private',
		'//outside.example/private',
		'\\\\outside.example/private',
		'javascript:alert(1)',
		'https://directory.example@outside.example/private',
		'https://user:pass@directory.example/private',
		'https://directory.example//outside.example/private',
		'https://['
	])('rejects an external return path: %s', async (callbackUrl) => {
		const query = `?${new URLSearchParams({ callbackUrl })}`;
		const { event, auth } = eventFor(query);
		expect(await load(event)).toMatchObject({ callbackUrl: '/' });
		auth.mockResolvedValue({ user: {}, expires: '2099-01-01' });
		await expectRedirect(load(event), '/');
	});

	it('normalizes a same-origin absolute return URL', async () => {
		const { event } = eventFor(
			`?${new URLSearchParams({ callbackUrl: 'https://directory.example/?link=photos#details' })}`
		);
		expect(await load(event)).toMatchObject({ callbackUrl: '/?link=photos#details' });
	});

	it.each([
		['CredentialsSignin', 'credentials'],
		['credentials', 'credentials'],
		['authentication', 'authentication'],
		['PRIVATE_PROVIDER_ERROR', 'authentication'],
		['', 'authentication']
	])('maps error query %s to a fixed machine state', async (rawError, error) => {
		const { event } = eventFor(`?${new URLSearchParams({ error: rawError })}`);
		const data = await load(event);
		expect(data.error).toBe(error);
		expect(JSON.stringify(data)).not.toContain('PRIVATE_');
	});

	it('does not convert a session lookup failure into an anonymous fallback', async () => {
		const { event, auth } = eventFor();
		const failure = new Error('PRIVATE_SESSION_FAILURE');
		auth.mockRejectedValue(failure);
		await expect(load(event)).rejects.toMatchObject({
			status: 401,
			body: { message: 'Access denied' }
		});
		expect(auth).toHaveBeenCalledOnce();
		expect(vi.mocked(logger.error).mock.calls).toEqual([
			['Authentication session failed (auth_session_failed).']
		]);
	});
});

describe('sign-in action', () => {
	it('redirects no-auth mode to root without invoking the wrapper', async () => {
		const { event, authentication } = eventFor();
		event.locals.authentication = undefined;
		await expectRedirect(actions.default(event), '/');
		expect(authentication.signIn).not.toHaveBeenCalled();
	});

	it('delegates the event once to the configured native-action wrapper', async () => {
		const { event, authentication, auth } = eventFor();
		await actions.default(event);
		expect(authentication.signIn).toHaveBeenCalledExactlyOnceWith(event);
		expect(auth).not.toHaveBeenCalled();
	});

	it('preserves the auth wrapper’s safe failure redirect without reading raw SDK errors', async () => {
		const { event, authentication } = eventFor();
		const safeRedirect = { status: 303, location: '/signin?error=authentication' };
		authentication.signIn.mockRejectedValue(safeRedirect);
		await expect(actions.default(event)).rejects.toBe(safeRedirect);
	});
});
