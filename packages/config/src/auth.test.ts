import { inspect } from 'node:util';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ConfigError } from './errors.js';
import { validateConfig } from './load.js';
import type { DirectoryAuth } from './types.js';

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
	'http://localhost:0',
	'http://localhost:65535'
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
	'http://directory.example.com',
	'http://127.0.0.1:3000',
	'http://[::1]:3000',
	'http://localhost.example.com',
	'http://sub.localhost',
	'http://localhost.',
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
describe('canonical auth origins', () => {
	it.each(acceptedOrigins)('accepts %j', (origin) => {
		expect(validateConfig({ links: {}, auth: { origin, credentials } }).auth?.origin).toBe(origin);
	});

	it.each([...rejectedOrigins, null, false, 3000, [], {}])(
		'rejects rather than normalizing %j',
		(origin) => {
			expect(() => validateConfig({ links: {}, auth: { origin, credentials } })).toThrow(
				ConfigError
			);
		}
	);
});

describe('optional auth secrets', () => {
	it.each(['x'.repeat(32), ' padded-secret-'.repeat(20)])(
		'preserves a supplied secret verbatim',
		(secret) => {
			expect(
				validateConfig({ links: {}, auth: { origin, secret, credentials } }).auth?.secret
			).toBe(secret);
		}
	);

	it.each([null, false, 32, [], {}, '', 'x'.repeat(31), ' '.repeat(32)])(
		'rejects invalid explicit secret %j',
		(secret) => {
			expect(() => validateConfig({ links: {}, auth: { origin, secret, credentials } })).toThrow(
				ConfigError
			);
		}
	);
});

describe('auth strategy boundary', () => {
	it('retains required origin and optional secret types', () => {
		expectTypeOf<DirectoryAuth['origin']>().toEqualTypeOf<string>();
		expectTypeOf<DirectoryAuth['secret']>().toEqualTypeOf<string | undefined>();
	});

	it('does not enable auth from environment settings alone', () => {
		expect(
			validateConfig({ links: {} }, { env: { ORIGIN: origin, AUTH_SECRET: secret } })
		).not.toHaveProperty('auth');
	});

	it.each(strategies)(
		'requires an explicit origin for $name and never generates a secret',
		({ strategy }) => {
			const env = { ORIGIN: origin, AUTH_SECRET: secret };
			expect(() => validateConfig({ links: {}, auth: strategy }, { env })).toThrow(ConfigError);
			const raw = { links: {}, auth: { origin, ...strategy } };
			const before = structuredClone(raw);
			expect(validateConfig(raw, { env }).auth).toEqual(raw.auth);
			expect(validateConfig(raw, { env }).auth).not.toHaveProperty('secret');
			expect(raw).toEqual(before);
			expect(validateConfig({ links: {}, auth: { origin, secret, ...strategy } }).auth).toEqual({
				origin,
				secret,
				...strategy
			});
		}
	);

	it('applies the shared origin and secret constraints to OIDC too', () => {
		expect(() =>
			validateConfig({ links: {}, auth: { origin: 'http://directory.example.com', oidc } })
		).toThrow(ConfigError);
		expect(() =>
			validateConfig({ links: {}, auth: { origin, secret: 'x'.repeat(31), oidc } })
		).toThrow(ConfigError);
	});
});

describe('auth interpolation and safe errors', () => {
	it('expands origin and secret before validation without changing authored input', () => {
		const raw = {
			links: {},
			auth: { origin: '${PUBLIC_ORIGIN:-http://localhost:3000}', secret: '${SECRET}', credentials }
		};
		const before = structuredClone(raw);
		expect(validateConfig(raw, { env: { PUBLIC_ORIGIN: origin, SECRET: secret } }).auth).toEqual({
			origin,
			secret,
			credentials
		});
		expect(validateConfig(raw, { env: { SECRET: secret } }).auth).toEqual({
			origin: 'http://localhost:3000',
			secret,
			credentials
		});
		expect(raw).toEqual(before);
	});

	it.each(['origin', 'secret'] as const)(
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
						{ links: {}, auth: { origin, secret, credentials, [field]: value } },
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
							{ code: 'missing_environment', path: `/auth/${field}` }
						]);
					}
				}
			}
		}
	);
});
