import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEditorSchema } from './editor-schema.js';
import { ConfigError } from './errors.js';
import { configurationReferences, DirectoryConfigurationSchema } from './schema.js';
import { loadConfigFile, validateConfig } from './load.js';
import type { ConfigEnvironment } from './types.js';

const link = { title: 'Photos', url: 'https://photos.example.com' };
const origin = 'https://directory.example.com';
const sentinel = 'SENTINEL-never-log-this';
let directory: string;

beforeAll(() => {
	directory = mkdtempSync(join(tmpdir(), 'directory-loader-'));
});
afterAll(() => {
	rmSync(directory, { recursive: true, force: true });
});

async function loadYaml(source: string, env: ConfigEnvironment = {}) {
	const path = join(directory, 'directory.yaml');
	writeFileSync(path, source);
	return loadConfigFile(path, { env });
}

function configurationError(action: () => unknown): ConfigError {
	try {
		action();
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		return error as ConfigError;
	}
	throw new Error('Expected configuration rejection');
}

function expectRedacted(error: unknown): void {
	expect(error).toBeInstanceOf(ConfigError);
	for (const text of [
		String(error),
		inspect(error),
		JSON.stringify(error),
		(error as Error).stack
	]) {
		expect(text).not.toContain(sentinel);
	}
	expect(error).not.toHaveProperty('cause');
}

describe('default, interpolate, then validate', () => {
	it('loads independent defaults while preserving authored values and order', () => {
		const raw = {
			links: {
				zebra: {
					...link,
					tags: [' photos ', '', 'backup', 'family, photos'],
					group: 'Other',
					admin_only: true
				},
				alpha: { ...link, title: 'Files' }
			}
		};
		const before = structuredClone(raw);
		const config = validateConfig(raw, { env: {} });
		expect(config.version).toBe(1);
		expect(config.site).toEqual({
			url: 'http://localhost:3000',
			title: 'Directory',
			description: '',
			footer: '',
			logo_path: '/favicon.png',
			favicon_path: '/favicon.png',
			open_links_in_new_tab: true
		});
		expect(config.appearance).toEqual({
			primary_light_color: '#0f766e',
			primary_dark_color: '#5eead4'
		});
		expect(Object.keys(config.links)).toEqual(['zebra', 'alpha']);
		expect(config.links.zebra).toMatchObject({
			tags: [' photos ', '', 'backup', 'family, photos'],
			group: 'Other',
			admin_only: true,
			requires_auth: false,
			internal_only: false
		});
		expect(config.links.alpha).toEqual({
			...link,
			title: 'Files',
			tags: [],
			requires_auth: false,
			internal_only: false,
			admin_only: false
		});
		expect(config).not.toHaveProperty('auth');
		expect(config.links.alpha).not.toHaveProperty('group');
		config.links.alpha!.tags.push('changed');
		expect(validateConfig(raw, { env: {} }).links.alpha!.tags).toEqual([]);
		expect(raw).toEqual(before);
	});

	it('keeps authored arrays independent and interpolates individual tag values once', () => {
		const raw = {
			links: { photos: { ...link, tags: [' ${TAG} ', 'family, photos', '${OPTIONAL:-}'] } }
		};
		const before = structuredClone(raw);
		const config = validateConfig(raw, { env: { TAG: 'PhOtOs' } });
		expect(config.links.photos!.tags).toEqual([' PhOtOs ', 'family, photos', '']);
		expect(config.links.photos!.tags).not.toBe(raw.links.photos.tags);
		config.links.photos!.tags.push('changed');
		expect(raw).toEqual(before);
		const missing = configurationError(() => validateConfig(raw, { env: {} }));
		expect(missing.issues).toMatchObject([
			{ code: 'missing_environment', path: '/links/*/tags/*' }
		]);
	});

	it('does not parse whole-list environment strings into arrays', () => {
		for (const tags of ['photos, backup', '[photos, backup]']) {
			expect(() =>
				validateConfig({ links: { photos: { ...link, tags: '${TAGS}' } } }, { env: { TAGS: tags } })
			).toThrow(ConfigError);
		}
	});

	it.each([
		{},
		{ title: 'Home' },
		{ logo_path: '/public/home.svg' },
		{ favicon_path: '/public/site.png' },
		{ logo_path: '/favicon.png' },
		{ favicon_path: '/favicon.png' },
		{ logo_path: '/favicon.png', favicon_path: '/favicon.png' }
	])('normalizes independent site image selections without mutating input: %j', (site) => {
		const raw = { site, links: { photos: link } };
		const before = structuredClone(raw);
		const config = validateConfig(raw, { env: {} });
		expect(config.site).toEqual({
			url: 'http://localhost:3000',
			title: 'Directory',
			description: '',
			footer: '',
			logo_path: '/favicon.png',
			favicon_path: '/favicon.png',
			open_links_in_new_tab: true,
			...site
		});
		expect(config.links.photos).not.toHaveProperty('logo_path');
		expect(config.links.photos).not.toHaveProperty('favicon_path');
		config.site.logo_path = '/public/changed.svg';
		expect(validateConfig(raw, { env: {} }).site.favicon_path).toBe(
			site.favicon_path ?? '/favicon.png'
		);
		expect(raw).toEqual(before);
	});

	it.each([true, false])(
		'preserves the authored global link target preference %s',
		(open_links_in_new_tab) => {
			const raw = { site: { open_links_in_new_tab }, links: { photos: link } };
			const before = structuredClone(raw);
			const config = validateConfig(raw, { env: {} });
			expect(config.site.open_links_in_new_tab).toBe(open_links_in_new_tab);
			expect(config.links.photos).not.toHaveProperty('open_links_in_new_tab');
			config.site.open_links_in_new_tab = !open_links_in_new_tab;
			expect(validateConfig(raw, { env: {} }).site.open_links_in_new_tab).toBe(
				open_links_in_new_tab
			);
			expect(raw).toEqual(before);
		}
	);

	it.each(
		['false', 'true', 0, 1, null, '', [], {}].map((open_links_in_new_tab) => ({
			open_links_in_new_tab
		}))
	)('rejects non-boolean target preference', ({ open_links_in_new_tab }) => {
		expect(() =>
			validateConfig({ site: { open_links_in_new_tab }, links: {} }, { env: {} })
		).toThrow(ConfigError);
	});

	it.each(['true', 'false'])('does not coerce the link target environment string %s', (FLAG) => {
		expect(() =>
			validateConfig({ site: { open_links_in_new_tab: '${FLAG}' }, links: {} }, { env: { FLAG } })
		).toThrow(ConfigError);
	});

	it.each([true, false])(
		'rejects per-bookmark link target preference %s',
		(open_links_in_new_tab) => {
			expect(() =>
				validateConfig({ links: { photos: { ...link, open_links_in_new_tab } } }, { env: {} })
			).toThrow(ConfigError);
		}
	);

	it('interpolates site image selections before applying the strict image boundary', () => {
		const raw = { site: { logo_path: '${LOGO}', favicon_path: '${ICON}' }, links: {} };
		const config = validateConfig(raw, { env: { LOGO: '/favicon.png', ICON: '/public/icon.png' } });
		expect(config.site.logo_path).toBe('/favicon.png');
		expect(config.site.favicon_path).toBe('/public/icon.png');
		expect(() =>
			validateConfig(raw, { env: { LOGO: '/favicon.png?x', ICON: '/public/icon.png' } })
		).toThrow(ConfigError);
		expect(() => validateConfig(raw, { env: {} })).toThrow(ConfigError);
	});

	it.each(['/public/icon.png', '/public/icons/service.svg'])(
		'rejects removed bookmark favicon selection %s',
		(favicon_path) => {
			expect(() =>
				validateConfig({ links: { photos: { ...link, favicon_path } } }, { env: {} })
			).toThrow(ConfigError);
		}
	);

	it('leaves canonical references intact for later validation and editor generation', () => {
		const references = [...configurationReferences];
		const canonical = JSON.stringify([DirectoryConfigurationSchema, configurationReferences]);
		const editor = createEditorSchema();
		validateConfig({ links: {} }, { env: {} });
		expect(() =>
			validateConfig({ links: { photos: { title: 'Missing URL' } } }, { env: {} })
		).toThrow(ConfigError);
		validateConfig({ links: { photos: link } }, { env: {} });
		expect(configurationReferences).toEqual(references);
		expect(JSON.stringify([DirectoryConfigurationSchema, configurationReferences])).toBe(canonical);
		expect(createEditorSchema()).toEqual(editor);
	});

	it('validates expanded URLs, paths and colors without converting types', () => {
		const config = validateConfig(
			{
				site: { title: '${TITLE}' },
				appearance: { primary_light_color: '${COLOR}' },
				links: {
					photos: {
						title: '${NAME:-Photos}',
						url: '${URL}',
						logo_path: '/public/${LOGO}',
						description: '$$ costs ${PRICE:-5}'
					}
				}
			},
			{
				env: {
					TITLE: 'Family',
					COLOR: '#123456',
					URL: 'https://photos.example.com',
					LOGO: 'photos.svg'
				}
			}
		);
		expect(config.site.title).toBe('Family');
		expect(config.appearance.primary_light_color).toBe('#123456');
		expect(config.links.photos).toMatchObject({
			logo_path: '/public/photos.svg',
			description: '$ costs 5'
		});
		for (const env of [{ URL: 'javascript:alert(1)' }, { URL: 'https://bad host' }]) {
			expect(() =>
				validateConfig({ links: { photos: { ...link, url: '${URL}' } } }, { env })
			).toThrow(ConfigError);
		}
		expect(() =>
			validateConfig(
				{ links: { photos: { ...link, admin_only: '${FLAG}' } } },
				{ env: { FLAG: 'true' } }
			)
		).toThrow(ConfigError);
	});

	it('loads either complete auth strategy and never fills missing credentials', () => {
		const credentials = validateConfig(
			{
				links: {},
				site: { url: origin },
				auth: { credentials: { username: 'family', password: '${PASSWORD}' } }
			},
			{ env: { PASSWORD: sentinel } }
		);
		expect(credentials.auth).toEqual({
			credentials: { username: 'family', password: sentinel }
		});
		const oidc = validateConfig(
			{
				links: {},
				site: { url: origin },
				auth: {
					oidc: { issuer: '${ISSUER}', client_id: 'directory', client_secret: '${SECRET}' }
				}
			},
			{ env: { ISSUER: 'https://identity.example.com', SECRET: sentinel } }
		);
		expect(oidc.auth).toEqual({
			oidc: {
				issuer: 'https://identity.example.com',
				client_id: 'directory',
				client_secret: sentinel
			}
		});
	});

	it.each([
		{ raw: { links: {}, site: [] }, path: '/site' },
		{ raw: { links: {}, appearance: [] }, path: '/appearance' },
		{ raw: { links: { photos: [] } }, path: '/links/*' },
		{ raw: { links: { photos: { ...link, tags: {} } } }, path: '/links/*/tags' },
		{ raw: { links: { photos: { ...link, tags: { photos: true } } } }, path: '/links/*/tags' },
		{ raw: { links: { photos: { ...link, tags: { '0': 'photos' } } } }, path: '/links/*/tags' }
	])('does not change an authored container kind at $path', ({ raw, path }) => {
		const error = configurationError(() => validateConfig(raw, { env: {} }));
		expect(error.issues).toMatchObject([{ code: 'invalid_shape', path }]);
	});

	it.each([
		{},
		{ links: [] },
		{ links: {}, site: null },
		{ links: {}, site: true },
		{ links: {}, appearance: 0 },
		{ links: {}, site: { title: null } },
		{ links: {}, site: { logo_path: null } },
		{ links: {}, site: { favicon_path: null } },
		{ links: {}, site: { logo_path: '' } },
		{ links: {}, site: { favicon_path: false } },
		{ links: {}, auth: {} },
		{ links: {}, auth: null },
		{ links: {}, site: { url: origin }, auth: { credentials: {} } },
		{
			links: {},
			site: { url: origin },
			auth: { oidc: { issuer: 'https://identity.example.com', client_id: 'directory' } }
		},
		{
			links: {},
			site: { url: origin },
			auth: { credentials: { username: 'family', password: 'test' }, oidc: null }
		},
		{
			links: {},
			auth: {
				credentials: { username: 'family', password: 'test' },
				oidc: {
					issuer: 'https://identity.example.com',
					client_id: 'directory',
					client_secret: 'test'
				}
			}
		},
		{ links: {}, unknown: true },
		{ links: {}, site: { group_by: 'tags' } },
		{ links: { photos: { ...link, sign_in: 'yes' } } },
		{ version: 2, links: {} },
		{ links: { photos: { ...link, tags: '' } } },
		{ links: { photos: { ...link, tags: 'photos, backup' } } },
		{ links: { photos: { ...link, tags: null } } },
		{ links: { photos: { ...link, tags: [1] } } },
		{ links: { photos: { ...link, tags: [['photos']] } } },
		{ links: { photos: { ...link, group: '' } } },
		{ links: { photos: { ...link, internal_only: 'false' } } }
	])('rejects invalid explicit data rather than replacing or cleaning it %#', (raw) => {
		expect(() => validateConfig(raw, { env: {} })).toThrow(ConfigError);
	});

	it('redacts missing env, invalid expanded values, auth values and authored keys', () => {
		const missing = configurationError(() =>
			validateConfig({ links: { photos: { ...link, title: '${MISSING}' } } }, { env: {} })
		);
		expect(missing.issues).toEqual([
			{
				code: 'missing_environment',
				path: '/links/*/title',
				message: 'An environment variable is not set.'
			}
		]);
		const invalid = configurationError(() =>
			validateConfig({ links: { photos: { ...link, url: '${URL}' } } }, { env: { URL: sentinel } })
		);
		expect(invalid.issues[0]?.path).toBe('/links/*/url');
		const badAuth = configurationError(() =>
			validateConfig(
				{
					links: {},
					site: { url: origin },
					auth: { credentials: { username: sentinel, password: {} } }
				},
				{ env: {} }
			)
		);
		const badKey = configurationError(() =>
			validateConfig(
				{ links: { [sentinel]: { ...link, url: sentinel } }, [sentinel]: true },
				{ env: {} }
			)
		);
		for (const error of [missing, invalid, badAuth, badKey]) expectRedacted(error);
	});
});

describe('runtime site URL defaults', () => {
	it.each([
		{ env: {}, url: 'http://localhost:3000' },
		{ env: { NODE_ENV: 'production' }, url: 'http://localhost:3000' },
		{ env: { NODE_ENV: 'test' }, url: 'http://localhost:3000' },
		{ env: { NODE_ENV: 'development' }, url: 'http://localhost:5173' },
		{ env: { PORT: '8080' }, url: 'http://localhost:8080' },
		{ env: { PORT: '65535', NODE_ENV: 'development' }, url: 'http://localhost:65535' },
		{ env: { PORT: '1' }, url: 'http://localhost:1' },
		{ env: { PORT: '80' }, url: 'http://localhost' },
		{
			env: { HOST: 'public.example.com', LISTEN_FDS: '0', SOCKET_PATH: '' },
			url: 'http://localhost:3000'
		}
	])('resolves omissions using only the supplied environment: $env', ({ env, url }) => {
		for (const site of [undefined, {}, { title: 'Home' }]) {
			const raw = { links: {}, ...(site ? { site } : {}) };
			const before = structuredClone(raw);
			const environment = Object.freeze({ ...env });
			expect(validateConfig(raw, { env: environment }).site.url).toBe(url);
			expect(validateConfig(raw, { env: environment }).site.url).toBe(url);
			expect(raw).toEqual(before);
			expect(environment).toEqual(env);
		}
	});

	it('uses process.env consistently, without leaking it into an injected environment', () => {
		try {
			vi.stubEnv('NODE_ENV', 'development');
			vi.stubEnv('PORT', undefined);
			vi.stubEnv('SOCKET_PATH', undefined);
			vi.stubEnv('LISTEN_FDS', undefined);
			expect(validateConfig({ links: {} }).site.url).toBe('http://localhost:5173');
			expect(validateConfig({ links: {} }, { env: {} }).site.url).toBe('http://localhost:3000');
			vi.stubEnv('PORT', '8080');
			expect(validateConfig({ links: {} }).site.url).toBe('http://localhost:8080');
			expect(validateConfig({ links: {} }, { env: process.env }).site.url).toBe(
				'http://localhost:8080'
			);
			expect(process.env.PORT).toBe('8080');
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it.each([
		'',
		' ',
		'-1',
		'+3000',
		'65536',
		'1.5',
		'1e3',
		'0x10',
		'NaN',
		'Infinity',
		'3000\n',
		sentinel
	])('rejects invalid fallback PORT %j with a redacted site URL error', (PORT) => {
		const error = configurationError(() => validateConfig({ links: {} }, { env: { PORT } }));
		expect(error.issues).toMatchObject([{ code: 'invalid_value', path: '/site/url' }]);
		expectRedacted(error);
	});

	it.each([
		{ PORT: '0' },
		{ PORT: '00' },
		{ SOCKET_PATH: '/private/socket' },
		{ LISTEN_FDS: '1' },
		{ LISTEN_FDS: '2', PORT: '3000' }
	])('requires an explicit URL for random ports or sockets: %j', (env) => {
		const error = configurationError(() => validateConfig({ links: {} }, { env }));
		expect(error.issues).toMatchObject([{ code: 'invalid_value', path: '/site/url' }]);
		expect(error.message).toContain('Set site.url explicitly');
		expect(error.message).not.toContain('/private/socket');
	});

	it.each([
		{ PORT: '0' },
		{ PORT: sentinel },
		{ SOCKET_PATH: '/private/socket' },
		{ LISTEN_FDS: '3', PORT: '0' },
		{ NODE_ENV: 'development', PORT: '8080' }
	])(
		'preserves explicit and interpolated URLs regardless of listener settings: %j',
		async (env) => {
			for (const url of [origin, '${PUBLIC_URL}']) {
				const config = await loadYaml(`site:\n  url: '${url}'\nlinks: {}\n`, {
					...env,
					PUBLIC_URL: origin
				});
				expect(config.site.url).toBe(origin);
			}
		}
	);

	it.each([null, '', false, 8080, [], {}, 'not an origin'])(
		'does not treat an explicit invalid URL as omitted: %j',
		(url) => {
			const error = configurationError(() =>
				validateConfig({ links: {}, site: { url } }, { env: { PORT: '0' } })
			);
			expect(error.issues.length).toBeGreaterThan(0);
			expect(error.issues.every((issue) => issue.path === '/site/url')).toBe(true);
			expect(error.message).not.toContain('Set site.url explicitly');
		}
	);

	it('keeps defaults stable across repeated file loads and resolved configuration validation', async () => {
		const env = Object.freeze({ NODE_ENV: 'development', PORT: '8080' });
		const initial = await loadYaml('links: {}', env);
		const reloaded = await loadYaml('links: {}', env);
		expect(reloaded).toEqual(initial);
		expect(validateConfig(initial, { env: { PORT: '0', SOCKET_PATH: '/private/socket' } })).toEqual(
			initial
		);
	});
});

describe('optional Open Graph image', () => {
	it.each([undefined, {}, { title: 'Home' }])(
		'leaves an omitted image absent after defaults: %j',
		(site) => {
			const config = validateConfig({ links: {}, ...(site ? { site } : {}) }, { env: {} });
			expect(config.site).not.toHaveProperty('og_image_path');
		}
	);

	it.each([
		'/public/share.png',
		'/public/cards/home.JPEG',
		'/public/family photo.jpg',
		'/public/图标/家.webp',
		'/public/share.svg',
		'/public/share.gif',
		'/public/missing.png'
	])('preserves a local image without requiring the file to exist: %s', (og_image_path) => {
		const raw = { site: { og_image_path }, links: {} };
		const before = structuredClone(raw);
		expect(validateConfig(raw, { env: {} }).site.og_image_path).toBe(og_image_path);
		expect(raw).toEqual(before);
	});

	it.each(
		[
			null,
			false,
			1,
			[],
			{},
			'',
			'/favicon.png',
			'https://example.com/share.png',
			'//example.com/share.png',
			'data:image/png;base64,AAAA',
			'file:///public/share.png',
			'public/share.png',
			'/share.png',
			'/public/../share.png',
			'/public/./share.png',
			'/public//share.png',
			'/public/%2e%2e/share.png',
			'/public/a\\b.png',
			'/public/share.png?size=large',
			'/public/share.png#image',
			'/public/share.html',
			'/public/share.png\n',
			'/public/share\u0000.png'
		].map((og_image_path) => ({ og_image_path }))
	)('rejects invalid, remote and bundled image selections: $og_image_path', ({ og_image_path }) => {
		const error = configurationError(() =>
			validateConfig({ site: { og_image_path }, links: {} }, { env: {} })
		);
		expect(error.issues).toMatchObject([{ path: '/site/og_image_path' }]);
	});

	it('validates interpolated paths with the same local-only boundary', () => {
		const raw = { site: { og_image_path: '${IMAGE}' }, links: {} };
		expect(validateConfig(raw, { env: { IMAGE: '/public/share.png' } }).site.og_image_path).toBe(
			'/public/share.png'
		);
		for (const env of [{}, { IMAGE: '/favicon.png' }, { IMAGE: 'https://example.com/share.png' }]) {
			expect(() => validateConfig(raw, { env })).toThrow(ConfigError);
		}
	});

	it('loads an optional image from YAML without changing other site defaults', async () => {
		const config = await loadYaml('site:\n  og_image_path: /public/share.png\nlinks: {}\n');
		expect(config.site).toEqual({
			...validateConfig({ links: {} }, { env: {} }).site,
			og_image_path: '/public/share.png'
		});
		await expect(loadYaml('site: {og_image_path: null}\nlinks: {}\n')).rejects.toBeInstanceOf(
			ConfigError
		);
	});
});

describe('YAML file loader', () => {
	it.each([
		{ site: '', expected: true },
		{ site: 'site: {open_links_in_new_tab: true}\n', expected: true },
		{ site: 'site: {open_links_in_new_tab: false}\n', expected: false }
	])('normalizes the YAML global link target preference: $site', async ({ site, expected }) => {
		const config = await loadYaml(`${site}links: {}\n`);
		expect(config.site.open_links_in_new_tab).toBe(expected);
	});

	it.each(['"false"', '"true"', '0', '1', 'null', '[]', '{}'])(
		'rejects non-boolean YAML global link target preference %s',
		async (value) => {
			await expect(
				loadYaml(`site: {open_links_in_new_tab: ${value}}\nlinks: {}\n`)
			).rejects.toBeInstanceOf(ConfigError);
		}
	);

	it('loads minimal YAML with defaults and no auth', async () => {
		const config = await loadYaml('links: {}\n');
		expect(config.version).toBe(1);
		expect(config.links).toEqual({});
		expect(config).not.toHaveProperty('auth');
		expect(config.site).toEqual({
			url: 'http://localhost:3000',
			title: 'Directory',
			description: '',
			footer: '',
			logo_path: '/favicon.png',
			favicon_path: '/favicon.png',
			open_links_in_new_tab: true
		});
		expect(config.appearance).toEqual({
			primary_light_color: '#0f766e',
			primary_dark_color: '#5eead4'
		});
	});

	it('validates the downloadable starter without auth or environment values', async () => {
		const path = fileURLToPath(new URL('../../../docs/directory.example.yaml', import.meta.url));
		const config = await loadConfigFile(path, { env: {} });
		expect(config.version).toBe(1);
		expect(Object.keys(config.links).length).toBeGreaterThan(0);
		expect(config).not.toHaveProperty('auth');
	});

	it('loads interpolated auth settings from YAML', async () => {
		const secret = 'test-only-secret-0123456789abcdef';
		const config = await loadYaml(
			`links: {}
site:
  url: '\${PUBLIC_ORIGIN}'
auth:
  secret: '\${SESSION_SECRET}'
  credentials:
    username: family
    password: '\${PASSWORD}'
`,
			{ PUBLIC_ORIGIN: origin, SESSION_SECRET: secret, PASSWORD: sentinel }
		);
		expect(config.site.url).toBe(origin);
		expect(config.auth).toEqual({
			secret,
			credentials: { username: 'family', password: sentinel }
		});
	});

	it('loads an empty directory, flat links, multiline descriptions and native booleans', async () => {
		expect((await loadYaml('links: {}')).links).toEqual({});
		const config = await loadYaml(`
links:
  photos:
    title: Photos
    url: https://photos.example.com
    requires_auth: true
    description: |
      Family photos.
      Install the mobile app.
`);
		expect(config.links.photos).toMatchObject({
			requires_auth: true,
			description: 'Family photos.\nInstall the mobile app.\n'
		});
		expect(config.links.photos).not.toHaveProperty('group');
	});

	it('loads flow and block tag lists with literal commas', async () => {
		const config = await loadYaml(
			`
links:
  photos:
    title: Photos
    url: https://photos.example.com
    tags: [photos, 'family, photos']
  files:
    title: Files
    url: https://files.example.com
    tags:
      - backup
      - '\${TAG}'
`,
			{ TAG: 'Family files' }
		);
		expect(config.links.photos!.tags).toEqual(['photos', 'family, photos']);
		expect(config.links.files!.tags).toEqual(['backup', 'Family files']);
	});

	it('uses YAML core scalar rules for unquoted text', async () => {
		const config = await loadYaml(`
links:
  photos:
    title: on
    url: https://photos.example.com
`);
		expect(config.links.photos?.title).toBe('on');
	});

	it('accepts bounded aliases without losing map order', async () => {
		const config = await loadYaml(`
links:
  zebra: &service {title: Photos, url: https://photos.example.com}
  alpha: *service
`);
		expect(Object.keys(config.links)).toEqual(['zebra', 'alpha']);
	});

	it('treats scalar mapping keys as strings while retaining strict slug rules', async () => {
		const config = await loadYaml(`
links:
  true: {title: Photos, url: https://photos.example.com}
`);
		expect(Object.keys(config.links)).toEqual(['true']);
		await expect(
			loadYaml(`
links:
  123: {title: Photos, url: https://photos.example.com}
`)
		).rejects.toBeInstanceOf(ConfigError);
	});

	it.each([
		'links: [SENTINEL-never-log-this',
		`links: {}
links: {}`,
		`links:
  photos: {title: First, title: Second, url: https://photos.example.com}`,
		`links: {}
---
links: {}`,
		'links: !SENTINEL-never-log-this {}',
		`%YAML 1.1
---
links: {}`,
		`links:
  ? [SENTINEL-never-log-this]
  : {title: Photos, url: https://photos.example.com}`
	])('rejects malformed, ambiguous or unsupported YAML %#', async (source) => {
		const error: unknown = await loadYaml(source).catch((error: unknown) => error);
		expectRedacted(error);
		expect(error).toMatchObject({ issues: [{ code: 'invalid_yaml', path: '/' }] });
	});

	it.each(['', 'null', '[]', 'links: null', 'links: &links {photos: *links}', '<<: {links: {}}'])(
		'rejects empty/scalar/cyclic documents and disabled merge keys %#',
		async (source) => {
			await expect(loadYaml(source)).rejects.toBeInstanceOf(ConfigError);
		}
	);

	it('rejects excessive aliases in otherwise valid configuration', async () => {
		const aliases = Array.from({ length: 101 }, (_, index) => `  service-${index}: *base`).join(
			'\n'
		);
		await expect(
			loadYaml(`
links:
  base: &base {title: Photos, url: https://photos.example.com}
${aliases}
`)
		).rejects.toMatchObject({ issues: [{ code: 'invalid_yaml', path: '/' }] });
	});

	it('rejects own prototype keys without pollution', async () => {
		await expect(
			loadYaml(`
links: {}
site:
  __proto__: {polluted: true}
`)
		).rejects.toMatchObject({ issues: [{ code: 'invalid_shape' }] });
		expect({}).not.toHaveProperty('polluted');
	});

	it('uses injected CONFIG_PATH when no path is provided', async () => {
		const path = join(directory, 'chosen.yml');
		writeFileSync(path, 'links: {}');
		expect((await loadConfigFile(undefined, { env: { CONFIG_PATH: path } })).links).toEqual({});
	});

	it('redacts unreadable filenames and Node read errors', async () => {
		for (const path of [join(directory, sentinel), join(directory, `${sentinel}\0`), directory]) {
			try {
				await loadConfigFile(path, { env: {} });
				throw new Error('Expected read failure');
			} catch (error) {
				expectRedacted(error);
				expect((error as ConfigError).issues).toEqual([
					{ code: 'file_unreadable', path: '/', message: 'Unable to read the configuration file.' }
				]);
			}
		}
	});
});
