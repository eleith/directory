import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEditorSchema } from './editor-schema.js';
import { ConfigError } from './errors.js';
import { configurationReferences, DirectoryConfigurationSchema } from './schema.js';
import { loadConfigFile, validateConfig } from './load.js';
import type { ConfigEnvironment } from './types.js';

const link = { title: 'Photos', url: 'https://photos.example.com' };
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
	it('loads defaults while retaining authored order, CSV text, group and advisory flags', () => {
		const raw = {
			links: {
				zebra: { ...link, tags: ' photos, , backup, ', group: 'Other', admin_only: true },
				alpha: { ...link, title: 'Files' }
			}
		};
		const before = structuredClone(raw);
		const config = validateConfig(raw, { env: {} });
		expect(config.version).toBe(1);
		expect(config.site).toEqual({
			title: 'Directory',
			description: '',
			footer: '',
			order: 'configured',
			logo_path: '/favicon.svg',
			favicon_path: '/favicon.svg'
		});
		expect(config.appearance).toEqual({
			primary_light_color: '#0f766e',
			primary_dark_color: '#5eead4'
		});
		expect(Object.keys(config.links)).toEqual(['zebra', 'alpha']);
		expect(config.links.zebra).toMatchObject({
			tags: ' photos, , backup, ',
			group: 'Other',
			admin_only: true,
			requires_auth: false,
			internal_only: false
		});
		expect(config.links.alpha).toEqual({
			...link,
			title: 'Files',
			tags: '',
			requires_auth: false,
			internal_only: false,
			admin_only: false
		});
		expect(config).not.toHaveProperty('auth');
		expect(config.links.alpha).not.toHaveProperty('group');
		expect(raw).toEqual(before);
	});

	it.each([
		{},
		{ title: 'Home' },
		{ logo_path: '/public/home.svg' },
		{ favicon_path: '/public/site.png' },
		{ logo_path: '/favicon.svg' },
		{ favicon_path: '/favicon.svg' },
		{ logo_path: '/favicon.svg', favicon_path: '/favicon.svg' }
	])('normalizes independent site image selections without mutating input: %j', (site) => {
		const raw = { site, links: { photos: link } };
		const before = structuredClone(raw);
		const config = validateConfig(raw, { env: {} });
		expect(config.site).toEqual({
			title: 'Directory',
			description: '',
			footer: '',
			order: 'configured',
			logo_path: '/favicon.svg',
			favicon_path: '/favicon.svg',
			...site
		});
		expect(config.links.photos).not.toHaveProperty('logo_path');
		expect(config.links.photos).not.toHaveProperty('favicon_path');
		config.site.logo_path = '/public/changed.svg';
		expect(validateConfig(raw, { env: {} }).site.favicon_path).toBe(
			site.favicon_path ?? '/favicon.svg'
		);
		expect(raw).toEqual(before);
	});

	it('interpolates site image selections before applying the strict image boundary', () => {
		const raw = { site: { logo_path: '${LOGO}', favicon_path: '${ICON}' }, links: {} };
		const config = validateConfig(raw, { env: { LOGO: '/favicon.svg', ICON: '/public/icon.png' } });
		expect(config.site.logo_path).toBe('/favicon.svg');
		expect(config.site.favicon_path).toBe('/public/icon.png');
		expect(() =>
			validateConfig(raw, { env: { LOGO: '/favicon.svg?x', ICON: '/public/icon.png' } })
		).toThrow(ConfigError);
		expect(() => validateConfig(raw, { env: {} })).toThrow(ConfigError);
	});

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

	it('validates expanded URLs, paths, colors and enum values without converting types', () => {
		const config = validateConfig(
			{
				site: { order: '${ORDER}' },
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
					ORDER: 'alphabetical',
					COLOR: '#123456',
					URL: 'https://photos.example.com',
					LOGO: 'photos.svg'
				}
			}
		);
		expect(config.site.order).toBe('alphabetical');
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
			{ links: {}, auth: { credentials: { username: 'family', password: '${PASSWORD}' } } },
			{ env: { PASSWORD: sentinel } }
		);
		expect(credentials.auth).toEqual({ credentials: { username: 'family', password: sentinel } });
		const oidc = validateConfig(
			{
				links: {},
				auth: { oidc: { issuer: '${ISSUER}', client_id: 'directory', client_secret: '${SECRET}' } }
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
		{},
		{ links: [] },
		{ links: {}, site: [] },
		{ links: {}, appearance: [] },
		{ links: { photos: [] } },
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
		{ links: {}, auth: { credentials: {} } },
		{
			links: {},
			auth: { oidc: { issuer: 'https://identity.example.com', client_id: 'directory' } }
		},
		{ links: {}, auth: { credentials: { username: 'family', password: 'test' }, oidc: null } },
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
		{ links: { photos: { ...link, tags: ['photos'] } } },
		{ links: { photos: { ...link, tags: { photos: true } } } },
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
				{ links: {}, auth: { credentials: { username: sentinel, password: {} } } },
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

describe('YAML file loader', () => {
	it('validates the minimal production starter with defaults and no auth', async () => {
		const path = fileURLToPath(
			new URL('../../../apps/web/config/directory.example.yml', import.meta.url)
		);
		const config = await loadConfigFile(path, { env: {} });
		expect(config.version).toBe(1);
		expect(config.links).toEqual({});
		expect(config).not.toHaveProperty('auth');
		expect(config.site).toEqual({
			title: 'Directory',
			description: '',
			footer: '',
			order: 'configured',
			logo_path: '/favicon.svg',
			favicon_path: '/favicon.svg'
		});
		expect(config.appearance).toEqual({
			primary_light_color: '#0f766e',
			primary_dark_color: '#5eead4'
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
