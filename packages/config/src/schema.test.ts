import { Value } from '@sinclair/typebox/value';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	configurationReferences,
	AppearanceSchema,
	SiteSchema,
	TagsSchema,
	HexColorSchema,
	HttpUrlSchema,
	LocalImagePathSchema,
	LinkSchema,
	DirectoryConfigurationSchema
} from './schema.js';
import type { DirectoryConfiguration, DirectoryLink } from './types.js';

const link = { title: 'Photos', url: 'https://photos.example.com' };
const raw = { links: { photos: link } };
const linkDefaults = { tags: '', requires_auth: false, internal_only: false, admin_only: false };

function defaultFixture(value: unknown) {
	return Value.Default(
		DirectoryConfigurationSchema,
		configurationReferences,
		structuredClone(value)
	);
}
function accepts(value: unknown): boolean {
	return Value.Check(DirectoryConfigurationSchema, configurationReferences, defaultFixture(value));
}

describe('configuration defaults and inferred types', () => {
	it('fills nested objects, the ordering union, and each link map value', () => {
		const value = defaultFixture({ links: { photos: link, router: { ...link, title: 'Router' } } });
		expect(Value.Check(DirectoryConfigurationSchema, configurationReferences, value)).toBe(true);
		expect(value).toEqual({
			version: 1,
			site: { title: 'Directory', description: '', footer: '', order: 'configured' },
			appearance: { primary_light_color: '#0f766e', primary_dark_color: '#5eead4' },
			links: {
				photos: { ...link, ...linkDefaults },
				router: { ...link, title: 'Router', ...linkDefaults }
			}
		});
	});

	it('allows an explicitly empty directory without synthesizing auth or grouping', () => {
		const value = defaultFixture({ links: {} });
		expect(accepts({ links: {} })).toBe(true);
		expect(value).not.toHaveProperty('auth');
		expect(defaultFixture(raw)).not.toHaveProperty('links.photos.group');
		expect(accepts({})).toBe(false);
	});

	it('keeps groups, comma-separated tags, multiline descriptions and advisory flags independent', () => {
		const value = defaultFixture({
			site: { title: 'Home', order: 'alphabetical' },
			appearance: { primary_light_color: '#abc' },
			links: {
				photos: {
					...link,
					description: 'First line\n<b>Plain text</b>',
					tags: 'photos, videos, backup',
					group: 'Photos & files',
					logo_path: '/public/photos.svg',
					favicon_path: '/public/icon.png',
					requires_auth: true,
					internal_only: false,
					admin_only: false
				},
				router: { ...link, requires_auth: true, internal_only: true, admin_only: true }
			}
		});
		expect(Value.Check(DirectoryConfigurationSchema, configurationReferences, value)).toBe(true);
		expect(value).not.toHaveProperty('auth');
		expect(value).not.toHaveProperty('links.router.group');
	});

	it('does not mutate authored input or share mutable defaults between calls', () => {
		const first = defaultFixture(raw);
		if (!Value.Check(DirectoryConfigurationSchema, configurationReferences, first))
			throw new Error('Invalid fixture');
		first.site.title = 'Changed';
		first.links['photos']!.requires_auth = true;
		expect(defaultFixture(raw)).toHaveProperty('site.title', 'Directory');
		expect(defaultFixture(raw)).toHaveProperty('links.photos.requires_auth', false);
		expect(raw).toEqual({ links: { photos: link } });
	});

	it('keeps loaded defaults required and genuinely optional metadata optional in TypeScript', () => {
		expectTypeOf<DirectoryConfiguration['version']>().toEqualTypeOf<1>();
		expectTypeOf<DirectoryConfiguration['site']['title']>().toEqualTypeOf<string>();
		expectTypeOf<DirectoryConfiguration['site']['order']>().toEqualTypeOf<
			'configured' | 'alphabetical'
		>();
		expectTypeOf<DirectoryConfiguration['auth']>().toBeNullable();
		expectTypeOf<DirectoryLink['tags']>().toEqualTypeOf<string>();
		expectTypeOf<DirectoryLink['group']>().toEqualTypeOf<string | undefined>();
		expectTypeOf<DirectoryLink['requires_auth']>().toEqualTypeOf<boolean>();
		expectTypeOf<DirectoryLink['internal_only']>().toEqualTypeOf<boolean>();
		expectTypeOf<DirectoryLink['admin_only']>().toEqualTypeOf<boolean>();
		expectTypeOf<DirectoryLink['description']>().toEqualTypeOf<string | undefined>();
		// @ts-expect-error loaded values must contain defaulted fields
		const incomplete: DirectoryConfiguration = { links: {} };
		// @ts-expect-error link titles remain required
		const missingTitle: DirectoryLink = { url: link.url, ...linkDefaults };
		// @ts-expect-error both auth strategies are forbidden statically too
		const both: NonNullable<DirectoryConfiguration['auth']> = {
			credentials: { username: 'family', password: 'fixture' },
			oidc: { issuer: 'https://id.example.com', client_id: 'directory', client_secret: 'fixture' }
		};
		void [incomplete, missingTitle, both];
	});
});

describe('strict configuration boundary', () => {
	it.each(
		[
			{},
			null,
			[],
			'',
			{ credentials: {} },
			{ credentials: { username: 'family' } },
			{ credentials: { username: 'family', password: '' } },
			{ oidc: { issuer: 'https://id.example.com', client_id: 'directory' } },
			{ oidc: { issuer: 'javascript:alert(1)', client_id: 'directory', client_secret: 'fixture' } },
			{ credentials: { username: 'family', password: 'fixture' }, oidc: null },
			{
				credentials: { username: 'family', password: 'fixture' },
				oidc: { issuer: 'https://id.example.com', client_id: 'directory', client_secret: 'fixture' }
			},
			{ unknown: {} }
		].map((auth) => ({ auth }))
	)('rejects invalid or ambiguous auth: $auth', ({ auth }) => {
		expect(accepts({ ...raw, auth })).toBe(false);
	});

	it.each([
		{ credentials: { username: 'family', password: 'fixture' } },
		{ oidc: { issuer: 'https://id.example.com', client_id: 'directory', client_secret: 'fixture' } }
	])('accepts exactly one complete auth strategy', (auth) => {
		expect(accepts({ ...raw, auth })).toBe(true);
	});

	it.each([
		'',
		'123',
		'-photos',
		'photos-',
		'photos--backup',
		'Photos',
		'photo_album',
		'a/b',
		'__proto__',
		'constructor',
		'prototype',
		'photos\n'
	])('rejects invalid slug %j', (slug) => {
		expect(accepts({ links: { [slug]: link } })).toBe(false);
	});

	it.each(['photos', 'photos-backup', '123-network'])('accepts non-numeric slug %s', (slug) => {
		expect(accepts({ links: { [slug]: link } })).toBe(true);
	});

	it.each(
		[
			{ title: 'Missing URL' },
			{ url: link.url },
			{ ...link, title: '   ' },
			{ ...link, tags: [] },
			{ ...link, tags: { topic: 'photos' } },
			{ ...link, tags: null },
			{ ...link, group: '' },
			{ ...link, group: '   ' },
			{ ...link, group: null },
			{ ...link, group: 1 },
			{ ...link, requires_auth: 'true' },
			{ ...link, internal_only: 1 },
			{ ...link, admin_only: null },
			{ ...link, sign_in: 'Your account' },
			{ ...link, works_from: 'Anywhere' },
			{ ...link, good_to_know: 'Redundant' },
			{ ...link, category: 'Family' },
			{ ...link, screenshot_path: '/public/screen.png' }
		].map((entry) => ({ entry }))
	)('rejects invalid link fields before defaulting', ({ entry }) => {
		expect(Value.Check(LinkSchema, configurationReferences, { ...linkDefaults, ...entry })).toBe(
			false
		);
	});

	it.each([
		{ ...raw, extra: true },
		{ ...raw, version: 2 },
		{ ...raw, version: null },
		{ ...raw, site: null },
		{ ...raw, site: { categories: {} } },
		{ ...raw, site: { group_by: 'section' } },
		{ ...raw, appearance: { background_color: '#fff' } },
		{ ...raw, auth: { credentials: { username: 'family', password: 'fixture', extra: true } } }
	])('rejects unknown structural fields and invalid explicit values', (value) => {
		expect(accepts(value)).toBe(false);
	});

	it('rejects explicit arrays/null at every defaultable object boundary before defaulting', () => {
		for (const schema of [SiteSchema, AppearanceSchema, LinkSchema]) {
			expect(Value.Check(schema, configurationReferences, [])).toBe(false);
			expect(Value.Check(schema, configurationReferences, null)).toBe(false);
		}
	});

	it('rejects own prototype-polluting keys before any defaulting', () => {
		for (const key of ['__proto__', 'constructor', 'prototype']) {
			const poisonedLink = JSON.parse(
				`{"title":"Bad","url":"https://example.com","tags":"","requires_auth":false,"internal_only":false,"admin_only":false,"${key}":{}}`
			) as unknown;
			expect(Value.Check(LinkSchema, configurationReferences, poisonedLink)).toBe(false);
			for (const value of [
				JSON.parse(`{"links":{},"${key}":{}}`) as unknown,
				JSON.parse(
					`{"links":{"${key}":{"title":"Bad","url":"https://example.com","tags":"","requires_auth":false,"internal_only":false,"admin_only":false}},"version":1,"site":{"title":"Directory","description":"","footer":"","order":"configured"},"appearance":{"primary_light_color":"#fff","primary_dark_color":"#000"}}`
				) as unknown
			]) {
				expect(Value.Check(DirectoryConfigurationSchema, configurationReferences, value)).toBe(
					false
				);
			}
		}
	});
});

describe('comma-separated tags', () => {
	it.each(['', 'photos', 'photos, videos, backup', ' photos , , videos ', '图像, Réseau'])(
		'accepts a simple comma-separated string %j',
		(tags) => expect(Value.Check(TagsSchema, tags)).toBe(true)
	);
	it.each(
		[[], {}, null, false, 1, 'photos\nbackup', 'photos\tbackup', 'photos\u0000backup'].map(
			(tags) => ({ tags })
		)
	)('rejects non-string/control-character tags', ({ tags }) =>
		expect(Value.Check(TagsSchema, tags)).toBe(false)
	);
});

describe('URL, image and color constraints', () => {
	it.each([
		'https://photos.example.com',
		'http://localhost:8080/a?q=b#section',
		'HTTP://router.example.com',
		'http://[::1]:3000'
	])('accepts HTTP(S) URL %s', (url) => {
		expect(Value.Check(HttpUrlSchema, url)).toBe(true);
	});
	it.each([
		'javascript:alert(1)',
		'data:text/html,test',
		'file:///etc/passwd',
		'//example.com',
		'/relative',
		'https://',
		'https://[broken',
		'https://a b.com',
		'https://example.com\n'
	])('rejects unsafe/malformed URL %j', (url) => {
		expect(Value.Check(HttpUrlSchema, url)).toBe(false);
	});
	it.each(['/public/map.svg', '/public/icons/family photo.JPG', '/public/图标/家.webp'])(
		'accepts local image %s',
		(path) => {
			expect(Value.Check(LocalImagePathSchema, path)).toBe(true);
		}
	);
	it.each([
		'https://example.com/logo.svg',
		'//example.com/logo.svg',
		'/favicon.svg',
		'/public/../logo.svg',
		'/public/a/../logo.svg',
		'/public/./logo.svg',
		'/public//logo.svg',
		'/public/%2e%2e/logo.svg',
		'/public/a%2fb.svg',
		'/public/a\\b.svg',
		'/public/logo.svg?x',
		'/public/logo.svg#x',
		'/public/logo.html',
		'/public/logo.svg\n'
	])('rejects unsafe/non-image path %j', (path) => {
		expect(Value.Check(LocalImagePathSchema, path)).toBe(false);
	});
	it.each(['#fff', '#0f766e', '#ABCDEF'])('accepts hex color %s', (color) => {
		expect(Value.Check(HexColorSchema, color)).toBe(true);
	});
	it.each(['red', '#ff', '#ffff', '#ffffffff', '#fff\n'])('rejects invalid color %j', (color) => {
		expect(Value.Check(HexColorSchema, color)).toBe(false);
	});
});
