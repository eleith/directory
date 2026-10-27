import { inspect } from 'node:util';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ConfigError } from './errors.js';
import { validateConfig } from './load.js';
import type { DirectoryAuth, DirectorySite } from './types.js';

const origin = 'https://directory.example.com';
const secret = 'test-only-secret-0123456789abcdef';
const credentials = { username: 'family', password: 'fixture' };
const oidc = { issuer: 'https://id.example.com', client_id: 'directory', client_secret: 'fixture' };
const strategies = [
	{ name: 'credentials', strategy: { credentials } },
	{ name: 'OIDC', strategy: { oidc } }
];

const acceptedOrigins = [
	origin,
	'https://directory.example.com:8443',
	'https://localhost',
	'https://127.0.0.1',
	'https://[::1]',
	'https://[2001:db8::1]:8443',
	'https://xn--bcher-kva.example',
	'https://directory.example.com.',
	'http://localhost',
	'http://localhost:3000',
	'http://localhost:443',
	'http://localhost:65535'
];
const insecureAuthOrigins = [
	'http://directory.example.com',
	'http://127.0.0.1:3000',
	'http://[::1]:3000',
	'http://localhost.example.com',
	'http://sub.localhost',
	'http://localhost.'
];
const rejectedOrigins = [
	'',
	' ',
	'null',
	'directory.example.com',
	'//directory.example.com',
	'ftp://directory.example.com',
	'javascript:alert(1)',
	'https://',
	'https://[broken',
	'https://user:password@directory.example.com',
	'https://@directory.example.com',
	'https://directory.example.com/',
	'https://directory.example.com/path',
	'https://directory.example.com/.',
	'https://directory.example.com/..',
	'https://directory.example.com?',
	'https://directory.example.com?query',
	'https://directory.example.com#',
	'https://directory.example.com#fragment',
	'https://directory.example.com\\path',
	'https:\\directory.example.com',
	'https:directory.example.com',
	'https:///directory.example.com',
	'HTTPS://directory.example.com',
	'https://DIRECTORY.example.com',
	'http://LOCALHOST:3000',
	'https://bücher.example',
	'https://%64irectory.example.com',
	'https://directory.example.com:443',
	'http://localhost:80',
	'http://localhost:03000',
	'http://localhost:0',
	'https://directory.example.com:0',
	'http://localhost:',
	'http://localhost:65536',
	'https://directory.example.com:008443',
	'https://127.1',
	'https://0x7f000001',
	'https://[0:0:0:0:0:0:0:1]',
	'https://[2001:DB8::1]',
	' https://directory.example.com',
	'https://directory.example.com ',
	'https://directory.example.com\n',
	'https://direc\ttory.example.com',
	'https://directory.example.com\u0000'
];

// These fields share validators across strategies; exercise URL attack classes once.
describe('canonical auth site URLs', () => {
	it.each(acceptedOrigins)('accepts %j', (origin) => {
		expect(
			validateConfig({ links: {}, site: { url: origin }, auth: { credentials } }).site.url
		).toBe(origin);
	});

	it.each([...insecureAuthOrigins, ...rejectedOrigins, null, false, 3000, [], {}])(
		'rejects rather than normalizing %j',
		(origin) => {
			expect(() =>
				validateConfig({ links: {}, site: { url: origin }, auth: { credentials } })
			).toThrow(ConfigError);
		}
	);
});

describe('canonical open site URLs', () => {
	it.each([
		...acceptedOrigins,
		...insecureAuthOrigins,
		'http://example.com:8080',
		'http://[2001:db8::1]'
	])('accepts canonical HTTP(S) without authentication: %j', (url) => {
		expect(validateConfig({ links: {}, site: { url } }, { env: {} }).site.url).toBe(url);
	});

	it.each([
		...rejectedOrigins,
		'http://example.com:80',
		'http://example.com/',
		'http://EXAMPLE.com',
		null,
		false,
		3000,
		[],
		{}
	])('rejects rather than normalizing %j', (url) => {
		expect(() => validateConfig({ links: {}, site: { url } }, { env: {} })).toThrow(ConfigError);
	});

	it.each(strategies)('rejects old auth.origin for $name, even with site.url', ({ strategy }) => {
		for (const site of [undefined, { url: origin }]) {
			expect(() =>
				validateConfig(
					{ links: {}, ...(site ? { site } : {}), auth: { origin, ...strategy } },
					{ env: {} }
				)
			).toThrow(ConfigError);
		}
	});

	it.each(strategies)(
		'reports HTTPS security violations at /site/url for $name',
		({ strategy }) => {
			for (const url of insecureAuthOrigins) {
				try {
					validateConfig({ links: {}, site: { url }, auth: strategy }, { env: {} });
					expect.fail('Expected HTTPS requirement');
				} catch (error) {
					expect(error).toBeInstanceOf(ConfigError);
					expect((error as ConfigError).issues).toMatchObject([
						{ code: 'invalid_value', path: '/site/url' }
					]);
				}
			}
		}
	);
});

describe('optional auth secrets', () => {
	it.each(['x'.repeat(32), ' padded-secret-'.repeat(20)])(
		'preserves a supplied secret verbatim',
		(secret) => {
			expect(
				validateConfig({ links: {}, site: { url: origin }, auth: { secret, credentials } }).auth
					?.secret
			).toBe(secret);
		}
	);

	it.each([null, false, 32, [], {}, '', 'x'.repeat(31), ' '.repeat(32)])(
		'rejects invalid explicit secret %j',
		(secret) => {
			expect(() =>
				validateConfig({ links: {}, site: { url: origin }, auth: { secret, credentials } })
			).toThrow(ConfigError);
		}
	);
});

describe('auth strategy boundary', () => {
	it('retains required site URL and originless auth with optional secret types', () => {
		expectTypeOf<DirectorySite['url']>().toEqualTypeOf<string>();
		expectTypeOf<DirectoryAuth>().not.toHaveProperty('origin');
		expectTypeOf<DirectoryAuth['secret']>().toEqualTypeOf<string | undefined>();
	});

	it('does not enable auth from environment settings alone', () => {
		expect(
			validateConfig({ links: {} }, { env: { ORIGIN: origin, AUTH_SECRET: secret } })
		).not.toHaveProperty('auth');
	});

	it.each(strategies)(
		'defaults site URL for $name and never generates a secret',
		({ strategy }) => {
			const env = { ORIGIN: origin, AUTH_SECRET: secret };
			expect(validateConfig({ links: {}, auth: strategy }, { env }).site.url).toBe(
				'http://localhost:3000'
			);
			const raw = { links: {}, site: { url: origin }, auth: { ...strategy } };
			const before = structuredClone(raw);
			expect(validateConfig(raw, { env }).auth).toEqual(raw.auth);
			expect(validateConfig(raw, { env }).auth).not.toHaveProperty('secret');
			expect(raw).toEqual(before);
			expect(
				validateConfig({ links: {}, site: { url: origin }, auth: { secret, ...strategy } }).auth
			).toEqual({
				secret,
				...strategy
			});
		}
	);

	it('applies the shared origin and secret constraints to OIDC too', () => {
		expect(() =>
			validateConfig({ links: {}, site: { url: 'http://directory.example.com' }, auth: { oidc } })
		).toThrow(ConfigError);
		expect(() =>
			validateConfig({ links: {}, site: { url: origin }, auth: { secret: 'x'.repeat(31), oidc } })
		).toThrow(ConfigError);
	});
});

describe('auth interpolation and safe errors', () => {
	it('expands origin and secret before validation without changing authored input', () => {
		const raw = {
			links: {},
			site: { url: '${PUBLIC_ORIGIN:-http://localhost:3000}' },
			auth: { secret: '${SECRET}', credentials }
		};
		const before = structuredClone(raw);
		expect(validateConfig(raw, { env: { PUBLIC_ORIGIN: origin, SECRET: secret } }).site.url).toBe(
			origin
		);
		expect(validateConfig(raw, { env: { SECRET: secret } }).site.url).toBe('http://localhost:3000');
		expect(validateConfig(raw, { env: { PUBLIC_ORIGIN: origin, SECRET: secret } }).auth).toEqual({
			secret,
			credentials
		});
		expect(validateConfig(raw, { env: { SECRET: secret } }).auth).toEqual({
			secret,
			credentials
		});
		expect(raw).toEqual(before);
	});

	it.each(['url', 'secret'] as const)(
		'redacts invalid literal, expanded and missing %s',
		(field) => {
			const sentinel = 'SENTINEL-NEVER-LOG-THIS';
			for (const { value, env } of [
				{ value: sentinel, env: {} },
				{ value: '${PRIVATE_VALUE}', env: { PRIVATE_VALUE: sentinel } },
				{ value: '${PRIVATE_VALUE}', env: {} }
			]) {
				try {
					validateConfig(
						{
							links: {},
							site: { url: field === 'url' ? value : origin },
							auth: { secret: field === 'secret' ? value : secret, credentials }
						},
						{ env }
					);
					expect.fail('Expected invalid auth');
				} catch (error) {
					expect(error).toBeInstanceOf(ConfigError);
					for (const text of [
						String(error),
						inspect(error),
						JSON.stringify(error),
						(error as Error).stack
					]) {
						expect(text).not.toContain(sentinel);
						expect(text).not.toContain('PRIVATE_VALUE');
						expect(text).not.toContain(secret);
					}
					expect(error).not.toHaveProperty('cause');
					if (value.startsWith('${') && !env.PRIVATE_VALUE) {
						expect((error as ConfigError).issues).toMatchObject([
							{ code: 'missing_environment', path: field === 'url' ? '/site/url' : '/auth/secret' }
						]);
					}
				}
			}
		}
	);
});
