import { validateConfig } from '@directory/config';
import type { DirectoryConfiguration } from '@directory/config/types';
import { describe, expect, it } from 'vitest';
import { prepareDirectory } from './directory.js';

const destination = { title: 'Photos', url: 'https://photos.example.com' };

function expectDeeplyFrozen(value: unknown): void {
	if (value === null || typeof value !== 'object') return;
	expect(Object.isFrozen(value)).toBe(true);
	for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe('prepareDirectory', () => {
	it('copies only public fields and preserves independent optional images and multiline text', () => {
		const config = validateConfig(
			{
				site: {
					title: 'Family',
					description: 'Welcome\nEveryone',
					footer: 'At home',
					logo_path: '/public/site.svg',
					favicon_path: '/public/site.png',
					order: 'alphabetical'
				},
				appearance: { primary_light_color: '#123', primary_dark_color: '#abcdef' },
				links: {
					photos: {
						...destination,
						description: 'First line\n\nSecond line\n',
						logo_path: '/public/photos.svg',
						favicon_path: '/public/photos.png',
						tags: ' photos, backup ',
						group: 'Family',
						requires_auth: true,
						internal_only: true,
						admin_only: true
					}
				}
			},
			{ env: {} }
		);

		expect(prepareDirectory(config, 'snapshot-one')).toEqual({
			snapshotId: 'snapshot-one',
			site: {
				title: 'Family',
				description: 'Welcome\nEveryone',
				footer: 'At home',
				logo_path: '/public/site.svg',
				favicon_path: '/public/site.png'
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
							favicon_path: '/public/photos.png',
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

	it('preserves absence rather than adding undefined optional fields', () => {
		const config = validateConfig({ links: { photos: destination } }, { env: {} });
		const display = prepareDirectory(config, 'minimal');
		expect(display).toEqual({
			snapshotId: 'minimal',
			site: { title: 'Directory', description: '', footer: '' },
			appearance: { primary_light_color: '#0f766e', primary_dark_color: '#5eead4' },
			grouped: false,
			groups: [
				{
					id: 'ungrouped',
					links: [
						{
							id: 'photos',
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
		expect(Object.keys(display.site).sort()).toEqual(['description', 'footer', 'title']);
		expect(Object.keys(display.groups[0]!.links[0]!).sort()).toEqual([
			'admin_only',
			'id',
			'internal_only',
			'requires_auth',
			'tags',
			'title',
			'url'
		]);
	});

	it('preserves empty optional descriptions and images independently', () => {
		const config = validateConfig(
			{
				site: { favicon_path: '/public/site.png' },
				links: { photos: { ...destination, description: '', logo_path: '/public/photo.svg' } }
			},
			{ env: {} }
		);
		const display = prepareDirectory(config, 'independent');
		expect(display.site).toHaveProperty('favicon_path', '/public/site.png');
		expect(display.site).not.toHaveProperty('logo_path');
		const link = display.groups[0]!.links[0]!;
		expect(link).toHaveProperty('description', '');
		expect(link).toHaveProperty('logo_path', '/public/photo.svg');
		expect(link).not.toHaveProperty('favicon_path');
	});

	it.each([
		['', []],
		[' ,  ,,, ', []],
		[' photos, , backup,,photos, ', ['photos', 'backup', 'photos']],
		[' "family, photos", backup ', ['"family', 'photos"', 'backup']]
	])('splits every comma in tags %j without a quoted CSV dialect', (tags, expected) => {
		const config = validateConfig({ links: { photos: { ...destination, tags } } }, { env: {} });
		const display = prepareDirectory(config, 'tags');
		expect(display.groups[0]!.links[0]!.tags).toEqual(expected);
		expect(config.links.photos!.tags).toBe(tags);
	});

	it('retains every link exactly once for all eight advisory flag combinations', () => {
		const links: DirectoryConfiguration['links'] = {};
		let index = 0;
		for (const requires_auth of [false, true]) {
			for (const internal_only of [false, true]) {
				for (const admin_only of [false, true]) {
					links[`flags-${index}`] = {
						...destination,
						tags: '',
						requires_auth,
						internal_only,
						admin_only
					};
					index += 1;
				}
			}
		}
		const config = validateConfig({ links }, { env: {} });
		const display = prepareDirectory(config, 'flags');
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
		{ credentials: { username: 'private-user', password: '${PRIVATE_VALUE}' } },
		{
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
		const display = prepareDirectory(config, 'redacted');
		const publicConfig = validateConfig({ links: { photos: destination } }, { env: {} });
		expect(display).toEqual(prepareDirectory(publicConfig, 'redacted'));
		expect(JSON.stringify(display)).not.toContain(sentinel);
		expect(display).not.toHaveProperty('auth');
		expect(display.site).not.toHaveProperty('order');
	});

	it('deeply freezes only its own DTO without mutating or freezing input', () => {
		const config = validateConfig(
			{
				links: { photos: { ...destination, group: 'Family', tags: 'photos,backup' } }
			},
			{ env: {} }
		);
		const original = structuredClone(config);
		const display = prepareDirectory(config, 'immutable');
		expectDeeplyFrozen(display);
		expect(config).toEqual(original);
		for (const value of [
			config,
			config.site,
			config.appearance,
			config.links,
			config.links.photos
		]) {
			expect(Object.isFrozen(value)).toBe(false);
		}
		expect(display.site).not.toBe(config.site);
		expect(display.appearance).not.toBe(config.appearance);
		expect(Reflect.set(display.site, 'title', 'Changed')).toBe(false);
		config.site.title = 'Input changed';
		config.links.photos!.title = 'Input link changed';
		expect(display.site.title).toBe('Directory');
		expect(display.groups[0]!.links[0]!.title).toBe('Photos');
	});
});
