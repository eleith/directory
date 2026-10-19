import { validateConfig } from '@directory/config';
import { describe, expect, it, vi } from 'vitest';
import type { Authentication } from '../lib/server/auth/index.js';
import { prepareSnapshot } from '../lib/server/config/snapshot.js';
import { actions, load } from './+page.server.js';

function eventFor() {
	const snapshot = prepareSnapshot(
		validateConfig(
			{
				site: { title: 'Home Server', description: 'Useful things running at home.' },
				auth: { credentials: { username: 'PRIVATE_USERNAME', password: 'PRIVATE_PASSWORD' } },
				links: { photos: { title: 'PRIVATE_LINK', url: 'https://photos.example.com' } }
			},
			{ env: {} }
		)
	);
	const locals = {
		snapshot,
		session: null,
		authentication: undefined,
		auth: vi.fn<App.Locals['auth']>().mockResolvedValue(null)
	} satisfies Partial<App.Locals>;
	return { locals } as unknown as Parameters<typeof load>[0];
}

describe('directory shell', () => {
	it('reads site copy from the request snapshot and excludes private data and links', () => {
		const data = load(eventFor());
		expect(data).toEqual({
			title: 'Home Server',
			description: 'Useful things running at home.',
			configurationVersion: 1,
			signedIn: false
		});
		expect(JSON.stringify(data)).not.toContain('PRIVATE_');
	});

	it('exposes only a boolean from the cached gate session without looking it up again', () => {
		const event = eventFor();
		event.locals.session = {
			user: { name: 'PRIVATE_IDENTITY', email: 'PRIVATE_EMAIL' },
			expires: '2099-01-01'
		};
		const data = load(event);
		expect(data).toEqual({
			title: 'Home Server',
			description: 'Useful things running at home.',
			configurationVersion: 1,
			signedIn: true
		});
		expect(JSON.stringify(data)).not.toContain('PRIVATE_');
		expect(event.locals.auth).not.toHaveBeenCalled();
	});
});

describe('sign-out action', () => {
	it('redirects no-auth mode to root', async () => {
		await expect(actions.signout(eventFor())).rejects.toMatchObject({ status: 303, location: '/' });
	});

	it('delegates once to the configured native-action wrapper', async () => {
		const event = eventFor();
		const signOut = vi.fn<Authentication['signOut']>().mockResolvedValue(undefined);
		event.locals.authentication = {
			strategy: 'credentials',
			handle: vi.fn<Authentication['handle']>(),
			signIn: vi.fn<Authentication['signIn']>(),
			signOut
		};
		await actions.signout(event);
		expect(signOut).toHaveBeenCalledExactlyOnceWith(event);
		expect(event.locals.auth).not.toHaveBeenCalled();
	});

	it('preserves the wrapper’s redirect', async () => {
		const event = eventFor();
		const safeRedirect = { status: 303, location: '/' };
		event.locals.authentication = {
			strategy: 'credentials',
			handle: vi.fn<Authentication['handle']>(),
			signIn: vi.fn<Authentication['signIn']>(),
			signOut: vi.fn<Authentication['signOut']>().mockRejectedValue(safeRedirect)
		};
		await expect(actions.signout(event)).rejects.toBe(safeRedirect);
	});
});
