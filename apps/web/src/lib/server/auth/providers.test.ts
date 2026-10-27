import { describe, expect, it, vi } from 'vitest';
import { timingSafeEqual } from 'node:crypto';
import type { CredentialsConfig } from '@auth/sveltekit/providers/credentials';
import { buildProviders, verifyCredentials } from './providers.js';

vi.mock('node:crypto', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:crypto')>();
	return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const credentials = { username: 'family', password: 'family-secret' };

describe('credentials', () => {
	it('returns only a fixed common identity', () => {
		expect(verifyCredentials(credentials, credentials)).toEqual({
			id: 'directory',
			name: 'Directory'
		});
	});

	it.each([
		undefined,
		{},
		{ username: 'wrong', password: credentials.password },
		{ username: credentials.username, password: 'wrong' },
		{ username: ['family'], password: credentials.password },
		{ username: credentials.username, password: { toString: () => credentials.password } },
		{ username: 'family ', password: credentials.password },
		{ username: credentials.username, password: 'family-secret\u0000' }
	])('denies wrong/malformed input: %j', (submitted) => {
		expect(verifyCredentials(credentials, submitted)).toBeNull();
	});

	it('always compares both fixed-size digests, even on a wrong username', () => {
		const compare = vi.mocked(timingSafeEqual);
		compare.mockClear();
		try {
			expect(verifyCredentials(credentials, { username: 'no', password: 'no' })).toBeNull();
			expect(compare).toHaveBeenCalledTimes(2);
			for (const [left, right] of compare.mock.calls) {
				expect(left.byteLength).toBe(32);
				expect(right.byteLength).toBe(32);
			}
		} finally {
			compare.mockClear();
		}
	});

	it('uses the native Credentials provider and captures configuration', async () => {
		const configured = { ...credentials };
		const provider = buildProviders({
			credentials: configured
		})[0];
		expect(provider).toMatchObject({ id: 'credentials', type: 'credentials' });
		if (!provider || typeof provider === 'function' || provider.type !== 'credentials') {
			throw new Error('Expected native credentials provider');
		}
		configured.password = 'changed';
		const options = provider.options as Partial<CredentialsConfig> | undefined;
		expect(
			await options?.authorize?.(credentials, new Request('https://directory.example'))
		).toEqual({
			id: 'directory',
			name: 'Directory'
		});
	});
});

it('explicitly requires OIDC PKCE, state and nonce without adding schema fields', () => {
	expect(
		buildProviders({
			oidc: { issuer: 'https://issuer.example', client_id: 'client', client_secret: 'secret' }
		})
	).toEqual([
		{
			id: 'oidc',
			name: 'SSO',
			type: 'oidc',
			issuer: 'https://issuer.example',
			clientId: 'client',
			clientSecret: 'secret',
			checks: ['pkce', 'state', 'nonce']
		}
	]);
});
