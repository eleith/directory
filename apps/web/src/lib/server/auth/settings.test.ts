import { describe, expect, it } from 'vitest';
import { requireAuthSettings } from './settings.js';

const origin = 'https://directory.example';
const env = { AUTH_SECRET: 'a'.repeat(32), ORIGIN: origin, AUTH_URL: origin };

describe('enabled authentication settings', () => {
	it.each([
		'https://directory.example',
		'https://directory.example:8443',
		'https://127.0.0.1:1234',
		'https://[::1]:1234',
		'http://localhost:1234'
	])('accepts matching canonical Kit and SDK origins: %s', (origin) => {
		expect(requireAuthSettings({ ...env, ORIGIN: origin, AUTH_URL: origin })).toEqual({
			secret: env.AUTH_SECRET,
			origin
		});
		expect(
			requireAuthSettings({ ...env, ORIGIN: origin, AUTH_URL: origin, NEXTAUTH_URL: origin })
		).toEqual({ secret: env.AUTH_SECRET, origin });
	});

	it.each([
		{},
		{ ...env, AUTH_SECRET: undefined },
		{ ...env, AUTH_SECRET: 'x'.repeat(31) },
		{ ...env, ORIGIN: undefined },
		{ ...env, AUTH_URL: undefined },
		{ ...env, AUTH_URL: 'https://evil.example' },
		{ ...env, NEXTAUTH_URL: 'http://directory.example' },
		{ ...env, NEXTAUTH_URL: '' },
		{ ...env, AUTH_REDIRECT_PROXY_URL: 'https://proxy.example/auth' }
	])('fails safely without reflecting invalid configuration: %j', (input) => {
		expect(() => requireAuthSettings(input)).toThrow('Authentication configuration invalid.');
	});

	it.each([
		`${origin}/`,
		'https://user:secret@directory.example',
		'https://directory.example/path',
		'https://directory.example/auth',
		'https://directory.example/?secret=1',
		'https://directory.example/#secret',
		'https://directory.example/#',
		'https://directory.example/?',
		'https://directory.example?secret=sentinel',
		'https://@directory.example',
		'https://directory.example/path/..',
		'HTTPS://DIRECTORY.example:443',
		' https://directory.example',
		'https://directory.example\\',
		'file:///tmp/private',
		'invalid secret sentinel',
		'http://127.0.0.1:1234',
		'http://127.1:1234',
		'http://[::1]:1234',
		'http://directory.example',
		'http://localhost.localdomain:1234',
		'http://localhost.:1234'
	])('rejects noncanonical or insecure origins in either setting: %s', (value) => {
		for (const name of ['ORIGIN', 'AUTH_URL', 'NEXTAUTH_URL']) {
			expect(() => requireAuthSettings({ ...env, [name]: value })).toThrow(
				'Authentication configuration invalid.'
			);
		}
		expect(() => requireAuthSettings({ ...env, ORIGIN: value, AUTH_URL: value })).toThrow(
			'Authentication configuration invalid.'
		);
	});
});
