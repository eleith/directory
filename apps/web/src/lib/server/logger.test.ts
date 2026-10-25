import { ConfigError } from '@directory/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthSettingsError } from './auth/settings.js';
import { DirectoryError } from './directory-error.js';
import { logger, reportDirectoryIssue, reportStartupFailure } from './logger.js';

const sentinel = 'PRIVATE-secret-environment-name-filename.yaml';
afterEach(() => vi.restoreAllMocks());

describe('safe server reporting', () => {
	it('reports only diagnostic codes and redacted issue paths, never whole errors or messages', () => {
		const output = vi.spyOn(logger, 'error').mockReturnValue(undefined);
		const issue = {
			code: 'load_failed' as const,
			issues: new ConfigError([
				{ code: 'invalid_value', path: `/links/${sentinel}/url` },
				{ code: 'missing_environment', path: '/auth/credentials/password' }
			]).issues.map((detail) => ({ ...detail, message: sentinel }))
		};
		reportDirectoryIssue(issue);
		expect(output.mock.calls).toEqual([
			['Configuration update rejected (load_failed).'],
			['  /links/*/url (invalid_value)'],
			['  /auth/credentials/password (missing_environment)']
		]);
		expect(JSON.stringify(output.mock.calls)).not.toContain(sentinel);
	});

	it.each(['prepare_failed', 'restart_required'] as const)('reports the static %s code', (code) => {
		const output = vi.spyOn(logger, 'error').mockReturnValue(undefined);
		reportDirectoryIssue({ code });
		expect(output).toHaveBeenCalledExactlyOnceWith(`Configuration update rejected (${code}).`);
	});

	it('reports safe startup directory diagnostics', () => {
		const output = vi.spyOn(logger, 'error').mockReturnValue(undefined);
		reportStartupFailure(new DirectoryError({ code: 'prepare_failed' }));
		expect(output).toHaveBeenCalledExactlyOnceWith('Application startup failed (prepare_failed).');
	});

	it.each([
		[
			'AUTH_SECRET',
			'Invalid authentication configuration: AUTH_SECRET is required when authentication is enabled and must contain at least 32 characters.'
		],
		[
			'ORIGIN',
			'Invalid authentication configuration: ORIGIN must be a canonical HTTPS root origin or HTTP localhost origin, with no trailing slash, path, query or fragment.'
		],
		[
			'AUTH_URL',
			'Invalid authentication configuration: AUTH_URL must be a canonical root origin matching ORIGIN exactly.'
		],
		[
			'NEXTAUTH_URL',
			'Invalid authentication configuration: NEXTAUTH_URL must match ORIGIN exactly or be unset.'
		],
		[
			'AUTH_REDIRECT_PROXY_URL',
			'Invalid authentication configuration: AUTH_REDIRECT_PROXY_URL is unsupported and must be unset.'
		]
	] as const)(
		'reports only a fixed hint for %s, ignoring even mutated error details',
		(setting, hint) => {
			const output = vi.spyOn(logger, 'error').mockReturnValue(undefined);
			const error = new AuthSettingsError(setting);
			error.message = sentinel;
			error.stack = sentinel;
			error.cause = new Error(sentinel);
			reportStartupFailure(error);
			expect(output.mock.calls).toEqual([['Application startup failed (auth_failed).'], [hint]]);
			expect(JSON.stringify(output.mock.calls)).not.toContain(sentinel);
		}
	);

	it('does not interpolate an unrecognized setting even on a typed error', () => {
		const output = vi.spyOn(logger, 'error').mockReturnValue(undefined);
		const error = new AuthSettingsError('AUTH_SECRET');
		Object.defineProperty(error, 'setting', { value: sentinel });
		reportStartupFailure(error);
		expect(output).toHaveBeenCalledExactlyOnceWith('Application startup failed (auth_failed).');
	});

	it.each([
		new Error(sentinel, { cause: sentinel }),
		{ message: sentinel, code: sentinel, path: sentinel },
		sentinel,
		undefined
	])('never inspects or prints unknown startup errors', (error) => {
		const output = vi.spyOn(logger, 'error').mockReturnValue(undefined);
		reportStartupFailure(error);
		expect(output).toHaveBeenCalledExactlyOnceWith('Application startup failed (startup_failed).');
	});
});
