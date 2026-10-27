import { validateConfig } from '@directory/config';
import type { DirectoryConfiguration } from '@directory/config/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DisplaySite } from '../../display/types.js';
import { getSite, prepareDirectoryContent } from './content.js';

const destination = { title: 'Photos', url: 'https://photos.example.com' };

function expectDeeplyFrozen(value: unknown): void {
	if (value === null || typeof value !== 'object') return;
	expect(Object.isFrozen(value)).toBe(true);
	for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe('prepareDirectoryContent', () => {
	it('copies only public fields and preserves site images, primary logos and multiline text', () => {
		const config = validateConfig(
			{
				site: {
					title: 'Family',
					description: 'Welcome\nEveryone',
					footer: 'At home',
					logo_path: '/public/site.svg',
					favicon_path: '/public/site.png'
				},
				appearance: { primary_light_color: '#123', primary_dark_color: '#abcdef' },
				links: {
					photos: {
						...destination,
						description: 'First line\n\nSecond line\n',
						logo_path: '/public/photos.svg',
						tags: [' photos ', ' backup '],
						group: 'Family',
						requires_auth: true,
						internal_only: true,
						admin_only: true
					}
				}
			},
			{ env: {} }
		);

		expect(prepareDirectoryContent(config, 'snapshot-one')).toEqual({
			snapshotId: 'snapshot-one',
			site: {
				title: 'Family',
				description: 'Welcome\nEveryone',
				footer: 'At home',
				logo_path: '/public/site.svg',
				favicon_path: '/public/site.png',
				open_links_in_new_tab: true
			},
			appearance: { primary_light_color: '#123', primary_dark_color: '#abcdef' },
			grouped: true,
			groups: [
				{
					id: 'named:Family',
					label: 'Family',
					links: [
						{
							id: 'photos',
							...destination,
							description: 'First line\n\nSecond line\n',
							logo_path: '/public/photos.svg',
							tags: ['photos', 'backup'],
							requires_auth: true,
							internal_only: true,
							admin_only: true
						}
					]
				}
			]
		});
	});

	it('selects resolved site defaults and preserves optional bookmark absence', () => {
		const config = validateConfig({ links: { photos: destination } }, { env: {} });
		const display = prepareDirectoryContent(config, 'minimal');
		expect(display).toEqual({
			snapshotId: 'minimal',
			site: {
				title: 'Directory',
				description: '',
				footer: '',
				logo_path: '/favicon.png',
				favicon_path: '/favicon.png',
				open_links_in_new_tab: true
			},
			appearance: { primary_light_color: '#0f766e', primary_dark_color: '#5eead4' },
			grouped: false,
			groups: [
				{
					id: 'ungrouped',
					links: [
						{
							id: 'photos',
							logo_path: '/bookmarks/photos/logo',
							...destination,
							tags: [],
							requires_auth: false,
							internal_only: false,
							admin_only: false
						}
					]
				}
			]
		});
		expect(Object.keys(display.site).sort()).toEqual([
			'description',
			'favicon_path',
			'footer',
			'logo_path',
			'open_links_in_new_tab',
			'title'
		]);
		expect(Object.keys(display.groups[0]!.links[0]!).sort()).toEqual([
			'admin_only',
			'id',
			'internal_only',
			'logo_path',
			'requires_auth',
			'tags',
			'title',
			'url'
		]);
	});

	it.each([true, false])(
		'projects the normalized global link target preference %s directly',
		(open_links_in_new_tab) => {
			const config = validateConfig(
				{ site: { open_links_in_new_tab }, links: { photos: destination } },
				{ env: {} }
			);
			const before = structuredClone(config);
			const site = getSite(config);
			expectTypeOf<DisplaySite['open_links_in_new_tab']>().toEqualTypeOf<boolean>();
			expect(site.open_links_in_new_tab).toBe(open_links_in_new_tab);
			const display = prepareDirectoryContent(config, 'link-target');
			expect(display.site).toEqual(site);
			expect(display.groups[0]!.links[0]!).not.toHaveProperty('open_links_in_new_tab');
			expect(config).toEqual(before);
		}
	);

	it('preserves empty descriptions and primary logos independently of site images', () => {
		const config = validateConfig(
			{
				site: { favicon_path: '/public/site.png' },
				links: { photos: { ...destination, description: '', logo_path: '/public/photo.svg' } }
			},
			{ env: {} }
		);
		const original = structuredClone(config);
		const display = prepareDirectoryContent(config, 'independent');
		expect(config).toEqual(original);
		expect(display.site).toHaveProperty('favicon_path', '/public/site.png');
		expect(display.site).toHaveProperty('logo_path', '/favicon.png');
		const link = display.groups[0]!.links[0]!;
		expect(link).toHaveProperty('description', '');
		expect(link).toHaveProperty('logo_path', '/public/photo.svg');
		expect(link).not.toHaveProperty('favicon_path');
		expect(Object.keys(link).sort()).toEqual([
			'admin_only',
			'description',
			'id',
			'internal_only',
			'logo_path',
			'requires_auth',
			'tags',
			'title',
			'url'
		]);
	});

	it.each<{ tags: string[]; expected: string[] }>([
		{ tags: [], expected: [] },
		{ tags: ['', '  ', '    '], expected: [] },
		{
			tags: [' photos ', ' ', ' backup ', '', 'photos'],
			expected: ['photos', 'backup', 'photos']
		},
		{ tags: ['Photos', 'photos', 'PHOTOS'], expected: ['Photos', 'photos', 'PHOTOS'] },
		{ tags: [' family, photos ', 'backup'], expected: ['family, photos', 'backup'] }
	])(
		'trims tags and drops blanks while preserving order, duplicates, case and commas: $tags',
		({ tags, expected }) => {
			const original = [...tags];
			const config = validateConfig({ links: { photos: { ...destination, tags } } }, { env: {} });
			const display = prepareDirectoryContent(config, 'tags');
			const displayTags = display.groups[0]!.links[0]!.tags;
			expect(displayTags).toEqual(expected);
			expect(displayTags).not.toBe(config.links.photos!.tags);
			expect(displayTags).not.toBe(tags);
			expect(config.links.photos!.tags).toEqual(original);
			expect(tags).toEqual(original);
		}
	);

	it('retains every link exactly once for all eight advisory flag combinations', () => {
		const links: DirectoryConfiguration['links'] = {};
		let index = 0;
		for (const requires_auth of [false, true]) {
			for (const internal_only of [false, true]) {
				for (const admin_only of [false, true]) {
					links[`flags-${index}`] = {
						...destination,
						tags: [],
						requires_auth,
						internal_only,
						admin_only
					};
					index += 1;
				}
			}
		}
		const config = validateConfig({ links }, { env: {} });
		const display = prepareDirectoryContent(config, 'flags');
		const displayLinks = display.groups.flatMap((group) => group.links);
		expect(displayLinks).toHaveLength(8);
		expect(new Set(displayLinks.map((link) => link.id)).size).toBe(8);
		for (const link of displayLinks) {
			const original = config.links[link.id]!;
			expect(link.requires_auth).toBe(original.requires_auth);
			expect(link.internal_only).toBe(original.internal_only);
			expect(link.admin_only).toBe(original.admin_only);
		}
	});

	it.each([
		{
			origin: 'https://directory.example.com',
			credentials: { username: 'private-user', password: '${PRIVATE_VALUE}' }
		},
		{
			origin: 'https://directory.example.com',
			oidc: {
				issuer: 'https://identity.example.com',
				client_id: 'private-client',
				client_secret: '${PRIVATE_VALUE}'
			}
		}
	])('does not copy auth, loading metadata, environment or future fields', (auth) => {
		const sentinel = 'PRIVATE-SENTINEL-DO-NOT-COPY';
		const config = validateConfig(
			{ links: { photos: destination }, auth },
			{
				env: { PRIVATE_VALUE: sentinel }
			}
		);
		Object.assign(config, {
			future: sentinel,
			environment: { PRIVATE_VALUE: sentinel },
			loadedFrom: sentinel
		});
		Object.assign(config.site, { future: sentinel });
		Object.assign(config.appearance, { future: sentinel });
		Object.assign(config.links.photos!, { future: sentinel });
		const display = prepareDirectoryContent(config, 'redacted');
		const publicConfig = validateConfig({ links: { photos: destination } }, { env: {} });
		expect(display).toEqual(prepareDirectoryContent(publicConfig, 'redacted'));
		expect(JSON.stringify(display)).not.toContain(sentinel);
		expect(display).not.toHaveProperty('auth');
	});

	it('deeply freezes only its own DTO without mutating or freezing input', () => {
		const config = validateConfig(
			{
				links: { photos: { ...destination, group: 'Family', tags: ['photos', 'backup'] } }
			},
			{ env: {} }
		);
		const original = structuredClone(config);
		const display = prepareDirectoryContent(config, 'immutable');
		expectDeeplyFrozen(display);
		expect(config).toEqual(original);
		for (const value of [
			config,
			config.site,
			config.appearance,
			config.links,
			config.links.photos,
			config.links.photos!.tags
		]) {
			expect(Object.isFrozen(value)).toBe(false);
		}
		expect(display.site).not.toBe(config.site);
		expect(display.appearance).not.toBe(config.appearance);
		const displayTags = display.groups[0]!.links[0]!.tags;
		expect(displayTags).not.toBe(config.links.photos!.tags);
		expect(Reflect.set(displayTags, '0', 'Changed')).toBe(false);
		expect(Reflect.set(display.site, 'title', 'Changed')).toBe(false);
		config.site.title = 'Input changed';
		config.links.photos!.title = 'Input link changed';
		config.links.photos!.tags.push('Input tag added');
		expect(display.site.title).toBe('Directory');
		expect(display.groups[0]!.links[0]!.title).toBe('Photos');
		expect(displayTags).toEqual(['photos', 'backup']);
	});
});
