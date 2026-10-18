import { ConfigError } from '@where/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectoryError } from './config/load-directory.js';
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
