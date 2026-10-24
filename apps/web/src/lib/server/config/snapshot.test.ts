import { validateConfig } from '@directory/config';
import { describe, expect, it, vi } from 'vitest';
import * as bookmarkLogos from '../bookmark-logos.js';
import { prepareSnapshot } from './snapshot.js';

const service = { title: 'Photos', url: 'https://photos.example.com' };

function configuration() {
	return validateConfig(
		{
			site: { title: 'Home', logo_path: '/public/home.svg', favicon_path: '/public/site-icon.png' },
			auth: { credentials: { username: 'PRIVATE_USERNAME', password: 'PRIVATE_PASSWORD' } },
			links: {
				photos: {
					...service,
					tags: [' photos ', ' backup '],
					logo_path: '/public/photos.svg'
				},
				files: {
					...service,
					title: 'Files',
					logo_path: '/public/shared.png',
					admin_only: true
				},
				album: {
					...service,
					title: 'Album',
					logo_path: '/public/photos-icon.png'
				},
				home: {
					...service,
					title: 'Home',
					logo_path: '/public/home.svg'
				}
			}
		},
		{ env: {} }
	);
}

describe('private prepared snapshots', () => {
	it('owns its configuration and display rather than freezing or retaining caller data', () => {
		const input = configuration();
		const before = structuredClone(input);
		const snapshot = prepareSnapshot(input);
		expect(input).toEqual(before);
		expect(Object.isFrozen(input)).toBe(false);
		expect(Object.isFrozen(input.site)).toBe(false);
		expect(snapshot.configuration).toEqual(input);
		expect(snapshot.configuration).not.toBe(input);
		expect(snapshot.configuration.site).not.toBe(input.site);
		expect(snapshot.configuration.links.photos!.tags).not.toBe(input.links.photos!.tags);
		const displayTags = snapshot.display.groups.flatMap((group) => group.links)[0]!.tags;
		expect(displayTags).not.toBe(snapshot.configuration.links.photos!.tags);
		expect(displayTags).not.toBe(input.links.photos!.tags);
		expect(Object.isFrozen(input.links.photos!.tags)).toBe(false);
		expect(Object.isFrozen(snapshot.configuration.links.photos!.tags)).toBe(true);
		expect(Object.isFrozen(displayTags)).toBe(true);
		expect(Reflect.set(displayTags, '0', 'Changed')).toBe(false);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.configuration)).toBe(true);
		expect(Object.isFrozen(snapshot.configuration.site)).toBe(true);
		expect(Object.isFrozen(snapshot.configuration.auth?.credentials)).toBe(true);
		expect(Object.isFrozen(snapshot.display)).toBe(true);
		expect(Object.isFrozen(snapshot.assets)).toBe(true);
		expect(Object.isFrozen(snapshot.assets.referencedPaths)).toBe(true);
		expect(Object.isFrozen(snapshot.assets.bookmarkLogos)).toBe(true);
		expect(Reflect.set(snapshot.assets.bookmarkLogos, 'photos', 'Changed')).toBe(false);
		input.site.title = 'Changed';
		input.links.photos!.tags.push('changed');
		if (input.auth?.credentials) input.auth.credentials.password = 'Changed';
		expect(snapshot.display.site.title).toBe('Home');
		expect(displayTags).toEqual(['photos', 'backup']);
		expect(snapshot.configuration.links.photos!.tags).toEqual([' photos ', ' backup ']);
		expect(snapshot.configuration.auth?.credentials?.password).toBe('PRIVATE_PASSWORD');
		expect(Reflect.set(snapshot.configuration.site, 'title', 'Changed')).toBe(false);
	});

	it('collects only site images and primary logos, deduplicating shared branding references', () => {
		const snapshot = prepareSnapshot(configuration());
		expect(snapshot.assets.brandingPaths).toEqual(['/public/home.svg', '/public/site-icon.png']);
		expect(snapshot.assets.referencedPaths).toEqual([
			'/public/home.svg',
			'/public/site-icon.png',
			'/public/photos.svg',
			'/public/shared.png',
			'/public/photos-icon.png'
		]);
		const links = snapshot.display.groups.flatMap((group) => group.links);
		expect(links).toHaveLength(4);
		expect(Object.keys(snapshot.assets.bookmarkLogos)).toEqual([
			'photos',
			'files',
			'album',
			'home'
		]);
		expect(snapshot.assets.brandingPaths).not.toContain('/public/shared.png');
		expect(snapshot.assets.brandingPaths).not.toContain('/public/photos-icon.png');
		for (const link of links) {
			expect(link.logo_path).toBe(snapshot.configuration.links[link.id]!.logo_path);
			expect(link).not.toHaveProperty('favicon_path');
			expect(snapshot.assets.bookmarkLogos[link.id]).toMatch(/^<svg\b/u);
		}
	});

	it('keeps authentication private while assigning a fresh non-secret display identity', () => {
		const input = configuration();
		const first = prepareSnapshot(input);
		const second = prepareSnapshot(input);
		expect(first.display.snapshotId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		);
		expect(second.display.snapshotId).not.toBe(first.display.snapshotId);
		expect(JSON.stringify(first.configuration)).toContain('PRIVATE_PASSWORD');
		expect(JSON.stringify(first.display)).not.toContain('PRIVATE_');
		expect(first.display).not.toHaveProperty('configuration');
		expect(first.display).not.toHaveProperty('auth');
		expect(first.display).not.toHaveProperty('assets');
	});

	it('prepares bookmark logos exactly once per cloned snapshot and retains coherent earlier captures', ({
		onTestFinished
	}) => {
		const generate = vi.spyOn(bookmarkLogos, 'getBookmarkLogos');
		onTestFinished(() => generate.mockRestore());
		const input = configuration();
		const captured = prepareSnapshot(input);
		expect(generate).toHaveBeenCalledTimes(1);
		expect(generate.mock.calls[0]?.[0]).toBe(captured.configuration);
		expect(generate.mock.calls[0]?.[0]).not.toBe(input);
		const capturedSvg = captured.assets.bookmarkLogos.photos;
		input.links.photos!.title = 'New Gallery';
		delete input.links.files;
		const current = prepareSnapshot(input);
		expect(generate).toHaveBeenCalledTimes(2);
		expect(current.assets.bookmarkLogos.photos).not.toBe(capturedSvg);
		expect(current.assets.bookmarkLogos).not.toHaveProperty('files');
		expect(current.display.groups[0]?.links[0]?.title).toBe('New Gallery');
		expect(captured.assets.bookmarkLogos.photos).toBe(capturedSvg);
		expect(captured.assets.bookmarkLogos.files).toMatch(/^<svg\b/u);
		expect(captured.display.groups[0]?.links[0]?.title).toBe('Photos');
		expect(JSON.stringify(current.display)).not.toContain('<svg');
		expect(JSON.stringify(current.display)).not.toContain('dicebear');
		expect(generate).toHaveBeenCalledTimes(2);
	});

	it.each([{}, { logo_path: '/favicon.svg', favicon_path: '/favicon.svg' }])(
		'excludes default and explicit bundled site images from mounted assets: %j',
		(site) => {
			const snapshot = prepareSnapshot(validateConfig({ site, links: {} }, { env: {} }));
			expect(snapshot.assets).toEqual({
				referencedPaths: [],
				brandingPaths: [],
				bookmarkLogos: {}
			});
			expect(snapshot.display.site.logo_path).toBe('/favicon.svg');
			expect(snapshot.display.site.favicon_path).toBe('/favicon.svg');
			expect(Object.isFrozen(snapshot.display.site)).toBe(true);
			expect(snapshot.display.groups.flatMap((group) => group.links)).toEqual([]);
		}
	);

	it('captures only mounted references when site selections mix bundled and mounted images', () => {
		const snapshot = prepareSnapshot(
			validateConfig(
				{
					site: { logo_path: '/favicon.svg', favicon_path: '/public/site.png' },
					links: {
						photos: { ...service, logo_path: '/public/photos.png' },
						plain: service
					}
				},
				{ env: {} }
			)
		);
		expect(snapshot.assets.brandingPaths).toEqual(['/public/site.png']);
		expect(snapshot.assets.referencedPaths).toEqual(['/public/site.png', '/public/photos.png']);
		expect(snapshot.display.groups[0]?.links[0]?.logo_path).toBe('/public/photos.png');
		expect(snapshot.display.groups[0]?.links[1]?.logo_path).toBe('/bookmarks/plain/logo');
	});
});
