import { validateConfig } from '@directory/config';
import { describe, expect, it, vi } from 'vitest';
import type { Authentication } from '../../lib/server/auth/index.js';
import { prepareSnapshot } from '../../lib/server/directory/snapshot.js';
import { actions, load } from './+page.server.js';

function eventFor(query = '', withAuth = false) {
	const configuration: Record<string, unknown> = {
		site: {
			...(withAuth ? { url: 'https://private-auth.example.test' } : {}),
			title: 'Home Server',
			description: 'Useful things running at home.',
			footer: 'Ask the household for help.',
			logo_path: '/public/site.png'
		},
		links: {
			photos: {
				title: 'Photos',
				url: 'https://photos.example.com',
				description: 'Family albums\nShared memories',
				group: 'Other',
				logo_path: '/public/photos.png',
				tags: ['family', 'photos', 'family, photos'],
				requires_auth: true
			},
			notes: {
				title: 'Notes',
				url: 'https://notes.example.com',
				group: 'Tools',
				admin_only: true
			},
			files: { title: 'Files', url: 'https://files.example.com', internal_only: true }
		}
	};
	if (withAuth) {
		configuration.auth = {
			secret: 'PRIVATE_SESSION_SECRET_AT_LEAST_32_CHARACTERS',
			credentials: { username: 'PRIVATE_USERNAME', password: 'PRIVATE_PASSWORD' }
		};
	}
	const snapshot = prepareSnapshot(validateConfig(configuration, { env: {} }));
	const locals = {
		snapshot,
		publicDir: '/PRIVATE_PUBLIC_ROOT',
		session: null,
		authentication: undefined
	} satisfies Partial<App.Locals>;
	return { locals, url: new URL(`https://directory.example/${query}`) } as unknown as Parameters<
		typeof load
	>[0];
}

const notFound = expect.objectContaining({ status: 404, body: { message: 'Not found' } });

describe('directory page data', () => {
	it('returns exactly the prepared display, selection and signed-in boolean in no-auth mode', () => {
		const event = eventFor();
		const data = load(event);
		expect(data).toEqual({
			directory: event.locals.snapshot.display,
			selectedLinkId: null,
			signedIn: false
		});
		expect(data.directory).toBe(event.locals.snapshot.display);
		expect(data.directory.site).toMatchObject({
			title: 'Home Server',
			description: 'Useful things running at home.',
			footer: 'Ask the household for help.',
			open_links_in_new_tab: true
		});
		expect(data.directory.groups.map((group) => group.id)).toEqual([
			'named:Other',
			'named:Tools',
			'ungrouped'
		]);
		expect(data.directory.groups[0]?.links[0]).toEqual({
			id: 'photos',
			title: 'Photos',
			url: 'https://photos.example.com',
			description: 'Family albums\nShared memories',
			logo_path: '/public/photos.png',
			tags: ['family', 'photos', 'family, photos'],
			requires_auth: true,
			internal_only: false,
			admin_only: false
		});
	});

	it('returns the captured same-tab preference without replacing it with a default', () => {
		const event = eventFor('?link=photos');
		const configuration = validateConfig(
			{
				...event.locals.snapshot.configuration,
				site: { ...event.locals.snapshot.configuration.site, open_links_in_new_tab: false }
			},
			{ env: {} }
		);
		event.locals.snapshot = prepareSnapshot(configuration);
		const data = load(event);
		expect(data.directory).toBe(event.locals.snapshot.display);
		expect(data.directory.site.open_links_in_new_tab).toBe(false);
		expect(data.selectedLinkId).toBe('photos');
	});

	it('includes authorized bookmark metadata but not credentials, identities, assets or root paths', () => {
		const event = eventFor('?link=photos', true);
		event.locals.session = {
			user: { name: 'PRIVATE_IDENTITY', email: 'PRIVATE_EMAIL' },
			expires: '2099-01-01'
		};
		Object.assign(event.locals, {
			configPath: '/PRIVATE_CONFIG_ROOT/directory.yaml',
			publicRoot: '/PRIVATE_PUBLIC_ROOT'
		});
		const data = load(event);
		expect(data).toEqual({
			directory: event.locals.snapshot.display,
			selectedLinkId: 'photos',
			signedIn: true
		});
		const serialized = JSON.stringify(data);
		expect(serialized).toContain('https://photos.example.com');
		expect(serialized).toContain('Family albums');
		expect(serialized).not.toContain('PRIVATE_');
		expect(serialized).not.toContain('private-auth.example.test');
		expect(serialized).not.toContain('2099-01-01');
		for (const field of [
			'configuration',
			'assets',
			'session',
			'authentication',
			'auth',
			'configPath',
			'publicRoot',
			'publicDir'
		]) {
			expect(data).not.toHaveProperty(field);
			expect(data.directory).not.toHaveProperty(field);
		}
	});

	it.each(['photos', 'notes', 'files'])(
		'selects the known link %s regardless of its service hints',
		(id) => {
			const data = load(eventFor(`?link=${id}`));
			expect(data.selectedLinkId).toBe(id);
			expect(data.directory.groups).toHaveLength(3);
		}
	);

	it.each([
		'?link=missing',
		'?link=',
		'?link',
		'?link=%20',
		'?link=PHOTOS',
		'?link=photos&link=photos',
		'?link=photos&link=notes',
		'?link=&link=photos',
		'?link=photos&link='
	])('rejects invalid selection %s with a generic 404', (query) => {
		expect(() => load(eventFor(query))).toThrowError(notFound);
	});

	it('uses only the public display for selection, not private configuration or asset names', () => {
		const event = eventFor('?link=photos');
		const display = event.locals.snapshot.display;
		const privateSnapshot = prepareSnapshot(
			validateConfig(
				{
					links: {
						hidden: { title: 'PRIVATE_LINK', url: 'https://private.example.com' }
					}
				},
				{ env: {} }
			)
		);
		event.locals.snapshot = {
			...privateSnapshot,
			display,
			assets: {
				bookmarkLogos: { photos: 'PRIVATE_SVG_BYTES' }
			}
		};
		expect(load(event)).toEqual({ directory: display, selectedLinkId: 'photos', signedIn: false });
		for (const id of ['hidden', 'PRIVATE_SVG_BYTES']) {
			event.url.search = `?link=${id}`;
			expect(() => load(event)).toThrowError(notFound);
		}
	});

	it('retains captured data when a later request receives a replacement snapshot', () => {
		const event = eventFor('?link=photos');
		const captured = event.locals.snapshot;
		const data = load(event);
		const replacement = prepareSnapshot(validateConfig({ links: {} }, { env: {} }));
		const laterEvent = eventFor();
		laterEvent.locals.snapshot = replacement;
		const updated = load(laterEvent);

		expect(data.directory).toBe(captured.display);
		expect(data.selectedLinkId).toBe('photos');
		expect(Object.isFrozen(data.directory)).toBe(true);
		expect(Object.isFrozen(data.directory.groups[0]?.links)).toBe(true);
		expect(updated).toEqual({
			directory: replacement.display,
			selectedLinkId: null,
			signedIn: false
		});
		expect(updated.directory.groups).toEqual([]);
		expect(data.directory.snapshotId).not.toBe(updated.directory.snapshotId);
		laterEvent.url.search = '?link=photos';
		expect(() => load(laterEvent)).toThrowError(notFound);
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
