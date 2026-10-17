import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ConfigError, type ConfigIssueCode } from './errors.js';

const sentinel = 'SENTINEL-private-data';

describe('redacted configuration errors', () => {
	it('keeps only known field names and hides all link IDs', () => {
		const error = new ConfigError([
			{ code: 'invalid_value', path: `/links/${sentinel}/url` },
			{ code: 'invalid_shape', path: `/site/${sentinel}~1~0` },
			{ code: 'missing_environment', path: '/auth/credentials/password' },
			{ code: 'invalid_value', path: '/links/site/title' }
		]);
		expect(error.issues.map((issue) => issue.path)).toEqual([
			'/links/*/url',
			'/site/*',
			'/auth/credentials/password',
			'/links/*/title'
		]);
		for (const rendered of [String(error), error.stack, JSON.stringify(error), inspect(error)]) {
			expect(rendered).not.toContain(sentinel);
		}
		expect(error).not.toHaveProperty('cause');
	});

	it.each(['', '/'])('normalizes the root location %j', (path) => {
		expect(new ConfigError([{ code: 'invalid_yaml', path }]).issues[0]?.path).toBe('/');
	});

	it('copies and freezes issues without retaining arbitrary messages or codes', () => {
		const input = { code: sentinel as ConfigIssueCode, path: `/${sentinel}`, message: sentinel };
		const error = new ConfigError([input]);
		input.path = '/site';
		expect(error.issues).toEqual([
			{
				code: 'invalid_value',
				path: '/*',
				message: 'Value does not match the configuration rules.'
			}
		]);
		expect(Object.isFrozen(error.issues)).toBe(true);
		expect(Object.isFrozen(error.issues[0])).toBe(true);
		expect(JSON.stringify(error)).not.toContain(sentinel);
	});
});
