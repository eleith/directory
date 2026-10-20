import { describe, expect, it } from 'vitest';
import { AuthSettingsError, requireAuthSettings } from './settings.js';

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
		[{}, 'AUTH_SECRET'],
		[{ ...env, AUTH_SECRET: undefined }, 'AUTH_SECRET'],
		[{ ...env, AUTH_SECRET: 'x'.repeat(31) }, 'AUTH_SECRET'],
		[{ ...env, ORIGIN: undefined }, 'ORIGIN'],
		[{ ...env, AUTH_URL: undefined }, 'AUTH_URL'],
		[{ ...env, AUTH_URL: 'https://evil.example' }, 'AUTH_URL'],
		[{ ...env, NEXTAUTH_URL: 'https://evil.example' }, 'NEXTAUTH_URL'],
		[{ ...env, NEXTAUTH_URL: 'http://directory.example' }, 'NEXTAUTH_URL'],
		[{ ...env, NEXTAUTH_URL: '' }, 'NEXTAUTH_URL'],
		[{ ...env, AUTH_REDIRECT_PROXY_URL: 'https://proxy.example/auth' }, 'AUTH_REDIRECT_PROXY_URL']
	] as const)('identifies only the failing setting: %j', (input, setting) => {
		expect(() => requireAuthSettings(input)).toThrow('Authentication configuration invalid.');
		try {
			requireAuthSettings(input);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(AuthSettingsError);
			expect(error).toHaveProperty('setting', setting);
			expect(error).not.toHaveProperty('cause');
		}
	});

	it('continues to accept an empty redirect proxy setting', () => {
		expect(requireAuthSettings({ ...env, AUTH_REDIRECT_PROXY_URL: '' })).toEqual({
			secret: env.AUTH_SECRET,
			origin
		});
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
			expect(() => requireAuthSettings({ ...env, [name]: value })).toThrow(
				expect.objectContaining({ setting: name })
			);
		}
		expect(() => requireAuthSettings({ ...env, ORIGIN: value, AUTH_URL: value })).toThrow(
			'Authentication configuration invalid.'
		);
	});
});
