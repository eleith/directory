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
	SiteImagePathSchema,
	LinkSchema,
	DirectoryConfigurationSchema
} from './schema.js';
import type { DirectoryConfiguration, DirectoryLink, DirectorySite } from './types.js';

const link = { title: 'Photos', url: 'https://photos.example.com' };
const raw = { links: { photos: link } };
const linkDefaults = { tags: [], requires_auth: false, internal_only: false, admin_only: false };

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
	it('fills nested objects and each link map value', () => {
		const value = defaultFixture({ links: { photos: link, router: { ...link, title: 'Router' } } });
		expect(Value.Check(DirectoryConfigurationSchema, configurationReferences, value)).toBe(true);
		expect(value).toEqual({
			version: 1,
			site: {
				url: 'http://localhost:3000',
				title: 'Directory',
				description: '',
				footer: '',
				logo_path: '/favicon.png',
				favicon_path: '/favicon.png',
				open_links_in_new_tab: true
			},
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
		expect(value).not.toHaveProperty('site.og_image_path');
		expect(defaultFixture(raw)).not.toHaveProperty('links.photos.group');
		expect(accepts({})).toBe(false);
	});

	it('keeps groups, tag lists, multiline descriptions and advisory flags independent', () => {
		const value = defaultFixture({
			site: { title: 'Home' },
			appearance: { primary_light_color: '#abc' },
			links: {
				photos: {
					...link,
					description: 'First line\n<b>Plain text</b>',
					tags: ['photos', 'videos', 'backup'],
					group: 'Photos & files',
					logo_path: '/public/photos.svg',
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

	it('keeps loaded defaults required and genuinely optional metadata optional in TypeScript', () => {
		expectTypeOf<DirectoryConfiguration['version']>().toEqualTypeOf<1>();
		expectTypeOf<DirectoryConfiguration['site']['title']>().toEqualTypeOf<string>();
		expectTypeOf<DirectoryConfiguration['site']['logo_path']>().toEqualTypeOf<string>();
		expectTypeOf<DirectoryConfiguration['site']['favicon_path']>().toEqualTypeOf<string>();
		expectTypeOf<DirectorySite['url']>().toEqualTypeOf<string>();
		expect(SiteSchema.required).toContain('url');
		expectTypeOf<DirectorySite['open_links_in_new_tab']>().toEqualTypeOf<boolean>();
		expectTypeOf<DirectorySite['og_image_path']>().toEqualTypeOf<string | undefined>();
		expectTypeOf<DirectoryLink['logo_path']>().toEqualTypeOf<string | undefined>();
		expectTypeOf<DirectoryConfiguration['auth']>().toBeNullable();
		expectTypeOf<DirectoryLink['tags']>().toEqualTypeOf<string[]>();
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
	it.each([true, false])(
		'accepts the global link target preference %s',
		(open_links_in_new_tab) => {
			const value = { ...raw, site: { open_links_in_new_tab } };
			expect(accepts(value)).toBe(true);
			expect(defaultFixture(value)).toHaveProperty(
				'site.open_links_in_new_tab',
				open_links_in_new_tab
			);
		}
	);

	it.each(
		['false', 'true', 0, 1, null, '', [], {}].map((open_links_in_new_tab) => ({
			open_links_in_new_tab
		}))
	)('rejects non-boolean target preference', ({ open_links_in_new_tab }) => {
		expect(accepts({ ...raw, site: { open_links_in_new_tab } })).toBe(false);
	});

	it.each([true, false])(
		'rejects per-bookmark link target preference %s',
		(open_links_in_new_tab) => {
			expect(accepts({ links: { photos: { ...link, open_links_in_new_tab } } })).toBe(false);
		}
	);

	it.each(
		[
			{},
			null,
			[],
			'',
			{ secret: 'x'.repeat(32) },
			{ credentials: null },
			{ oidc: null },
			{ credentials: {} },
			{ credentials: { username: 'family' } },
			{ credentials: { username: 'family', password: '' } },
			{ oidc: { issuer: 'https://id.example.com', client_id: 'directory' } },
			{ oidc: { issuer: 'javascript:alert(1)', client_id: 'directory', client_secret: 'fixture' } },
			{ credentials: { username: 'family', password: 'fixture' }, oidc: null },
			{
				oidc: {
					issuer: 'https://id.example.com',
					client_id: 'directory',
					client_secret: 'fixture'
				},
				credentials: null
			},
			{
				credentials: { username: 'family', password: 'fixture' },
				oidc: { issuer: 'https://id.example.com', client_id: 'directory', client_secret: 'fixture' }
			},
			{ unknown: {} }
		].map((auth) => ({
			auth
		}))
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
			{ ...link, tags: '' },
			{ ...link, tags: 'photos, backup' },
			{ ...link, tags: [1] },
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
			{ ...link, screenshot_path: '/public/screen.png' },
			{ ...link, favicon_path: '/public/icon.png' }
		].map((entry) => ({ entry }))
	)('rejects invalid link fields before defaulting', ({ entry }) => {
		expect(Value.Check(LinkSchema, configurationReferences, { ...linkDefaults, ...entry })).toBe(
			false
		);
	});

	it.each(['configured', 'alphabetical'])('rejects removed site.order value %s', (order) => {
		expect(accepts({ ...raw, site: { order } })).toBe(false);
	});

	it.each([
		{ ...raw, extra: true },
		{ ...raw, version: 2 },
		{ ...raw, version: null },
		{ ...raw, site: null },
		{ ...raw, site: { categories: {} } },
		{ ...raw, site: { group_by: 'section' } },
		{ ...raw, appearance: { background_color: '#fff' } },
		{
			...raw,
			auth: { credentials: { username: 'family', password: 'fixture', extra: true } }
		}
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
				`{"title":"Bad","url":"https://example.com","tags":[],"requires_auth":false,"internal_only":false,"admin_only":false,"${key}":{}}`
			) as unknown;
			expect(Value.Check(LinkSchema, configurationReferences, poisonedLink)).toBe(false);
			for (const value of [
				JSON.parse(`{"links":{},"${key}":{}}`) as unknown,
				JSON.parse(
					`{"links":{"${key}":{"title":"Bad","url":"https://example.com","tags":[],"requires_auth":false,"internal_only":false,"admin_only":false}},"version":1,"site":{"title":"Directory","description":"","footer":""},"appearance":{"primary_light_color":"#fff","primary_dark_color":"#000"}}`
				) as unknown
			]) {
				expect(Value.Check(DirectoryConfigurationSchema, configurationReferences, value)).toBe(
					false
				);
			}
		}
	});
});

describe('tag lists', () => {
	it.each(
		[
			[],
			['photos'],
			['photos', 'videos', 'backup'],
			[' photos ', '', '   ', 'backup'],
			['Family, photos', 'topic:orchard'],
			['图像', 'Réseau']
		].map((tags) => ({ tags }))
	)('accepts string labels with literal commas: $tags', ({ tags }) =>
		expect(Value.Check(TagsSchema, tags)).toBe(true)
	);
	it.each(
		[
			'',
			'photos',
			'photos, backup',
			{},
			null,
			false,
			1,
			[null],
			[false],
			[1],
			[{}],
			[['photos']],
			[undefined],
			['\t\n'],
			['photos\nbackup'],
			['photos\tbackup'],
			['photos\u0000backup']
		].map((tags) => ({ tags }))
	)('rejects scalar tags, non-string items and control characters: $tags', ({ tags }) =>
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
		'/favicon.png',
		'/favicon.png/',
		'/favicon.png?x',
		'/favicon.png#x',
		'/favicon%2epng',
		'/Favicon.png',
		'/favicon.png\n',
		'data:image/svg+xml,test',
		'file:///favicon.png',
		'favicon.png',
		'/public/logo\u0000.svg',
		'/public/logo\t.svg',
		'/public/logo\u007f.svg',
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
		if (path !== '/favicon.png') {
			expect(Value.Check(SiteImagePathSchema, configurationReferences, path)).toBe(false);
			for (const field of ['logo_path', 'favicon_path']) {
				expect(accepts({ ...raw, site: { [field]: path } })).toBe(false);
			}
		}
	});
	it('accepts the bundled mark only for site images, not bookmark logos', () => {
		for (const field of ['logo_path', 'favicon_path']) {
			expect(accepts({ ...raw, site: { [field]: '/favicon.png' } })).toBe(true);
		}
		expect(accepts({ links: { photos: { ...link, logo_path: '/favicon.png' } } })).toBe(false);
	});
	it.each(['#fff', '#0f766e', '#ABCDEF'])('accepts hex color %s', (color) => {
		expect(Value.Check(HexColorSchema, color)).toBe(true);
	});
	it.each(['red', '#ff', '#ffff', '#ffffffff', '#fff\n'])('rejects invalid color %j', (color) => {
		expect(Value.Check(HexColorSchema, color)).toBe(false);
	});
});
