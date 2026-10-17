import { inspect } from 'node:util';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ConfigError } from './errors.js';
import type { ConfigEnvironment } from './types.js';
import { interpolate } from './interpolate.js';

function missingEnvironmentError(node: unknown, env: ConfigEnvironment = {}): ConfigError {
	try {
		interpolate(node, env);
	} catch (error) {
		if (error instanceof ConfigError) return error;
		throw error;
	}
	throw new Error('Expected missing environment variables');
}

describe('interpolate', () => {
	it('replaces multiple variables inside nested string values without changing keys', () => {
		const input = {
			site: { title: '${TITLE}', description: 'Hello ${USER_2} / ${_SUFFIX}' },
			links: { '${UNSET_KEY}': { url: 'https://${HOST}/' } }
		};
		expect(
			interpolate(input, {
				TITLE: 'Home',
				USER_2: 'family',
				_SUFFIX: 'guests',
				HOST: 'photos.example.com'
			})
		).toEqual({
			site: { title: 'Home', description: 'Hello family / guests' },
			links: { '${UNSET_KEY}': { url: 'https://photos.example.com/' } }
		});
	});

	it.each([
		{ env: {}, expected: 'fallback' },
		{ env: { VALUE: undefined }, expected: 'fallback' },
		{ env: { VALUE: 'configured' }, expected: 'configured' },
		{ env: { VALUE: '' }, expected: '' }
	])('uses a fallback only when the variable is undefined: $env', ({ env, expected }) => {
		expect(interpolate('${VALUE:-fallback}', env)).toBe(expected);
	});

	it('allows an empty fallback and treats an empty environment value as set', () => {
		expect(interpolate('before${MISSING:-}after', {})).toBe('beforeafter');
		expect(interpolate('before${EMPTY}after', { EMPTY: '' })).toBe('beforeafter');
	});

	it.each([
		['$$', '$'],
		['$${VAR}', '${VAR}'],
		['$${MISSING}', '${MISSING}'],
		['$$${VAR}', '$value'],
		['$$$$', '$$'],
		['$${VAR:-fallback}', '${VAR:-fallback}']
	])('processes dollar escapes once: %s', (input, expected) => {
		expect(interpolate(input, { VAR: 'value' })).toBe(expected);
	});

	it('does not recursively expand environment values or fallback text', () => {
		expect(interpolate('${VALUE}', { VALUE: '${MISSING} $$ ${OTHER:-default}' })).toBe(
			'${MISSING} $$ ${OTHER:-default}'
		);
		expect(interpolate('${VALUE:-$$ $OTHER}', {})).toBe('$$ $OTHER');
		expect(interpolate('${VALUE:-${OTHER}}', { OTHER: 'expanded' })).toBe('${OTHER}');
		expect(interpolate('${VALUE}', { VALUE: "$& $` $' $1" })).toBe("$& $` $' $1");
	});

	it.each([
		'$',
		'$VAR',
		'${}',
		'${lowercase}',
		'${Mixed_CASE}',
		'${1VAR}',
		'${VÁR}',
		'${VAR-NAME}',
		'${VAR-default}',
		'${VAR:default}',
		'${VAR:+default}',
		'${VAR',
		'${VAR:-unterminated'
	])('leaves unrecognized syntax literal: %s', (input) => {
		expect(interpolate(input, {})).toBe(input);
	});

	it('reads only own environment properties', () => {
		const env: Record<string, string | undefined> = { OWN: 'own value' };
		Object.setPrototypeOf(env, { INHERITED: 'inherited value' });
		expect(interpolate('${OWN} ${INHERITED:-fallback}', env)).toBe('own value fallback');
		expect(missingEnvironmentError('${INHERITED}', env)).toBeInstanceOf(ConfigError);
		env['INHERITED'] = 'own override';
		expect(interpolate('${INHERITED}', env)).toBe('own override');
	});

	it('does not implicitly read process environment values', () => {
		expect(interpolate('${PATH:-explicit-only}', {})).toBe('explicit-only');
	});

	it('preserves booleans, numbers, empty objects, and the input type', () => {
		const input = { version: 1, enabled: true, hidden: false, amount: 0, links: {} };
		const result = interpolate(input, {});
		expect(result).toEqual(input);
		expectTypeOf(result).toEqualTypeOf<typeof input>();
		expect(interpolate(false, {})).toBe(false);
		expect(interpolate(42, {})).toBe(42);
	});

	it('does not mutate configuration or environment and returns independent objects', () => {
		const nested = Object.freeze({ title: '${TITLE}', enabled: true });
		const input = Object.freeze({ site: nested, links: Object.freeze({}) });
		const env = Object.freeze({ TITLE: 'Home' });
		const result = interpolate(input, env);
		expect(result).toEqual({ site: { title: 'Home', enabled: true }, links: {} });
		expect(result).not.toBe(input);
		expect(result.site).not.toBe(input.site);
		expect(result.links).not.toBe(input.links);
		expect(input).toEqual({ site: { title: '${TITLE}', enabled: true }, links: {} });
		expect(env).toEqual({ TITLE: 'Home' });
	});

	it('collects missing variables at field paths and deduplicates each field', () => {
		const error = missingEnvironmentError({
			site: { title: '${MISSING_A} ${MISSING_B} ${MISSING_A}' },
			auth: { credentials: { password: '${MISSING_C}' } }
		});
		expect(error).toMatchObject(
			new ConfigError([
				{ code: 'missing_environment', path: '/auth/credentials/password' },
				{ code: 'missing_environment', path: '/site/title' }
			])
		);
	});

	it('escapes JSON pointer segments and accepts a missing root string', () => {
		expect(missingEnvironmentError({ 'a/b~c': { title: '${MISSING}' } })).toMatchObject(
			new ConfigError([{ code: 'missing_environment', path: '/a~1b~0c/title' }])
		);
		expect(missingEnvironmentError('${MISSING}')).toMatchObject(
			new ConfigError([{ code: 'missing_environment', path: '/' }])
		);
	});

	it('does not retain variable names, values, environment or configuration on failure', () => {
		const input = Object.freeze({
			auth: Object.freeze({
				credentials: Object.freeze({
					password: 'private-prefix ${SECRET_DEFINED} ${SECRET_UNDEFINED}'
				})
			}),
			site: Object.freeze({ title: 'private-configuration-marker' })
		});
		const env = Object.freeze({
			SECRET_DEFINED: 'private-environment-marker',
			UNUSED: 'unused-environment-marker'
		});
		const error = missingEnvironmentError(input, env);
		const diagnostic = inspect(error, { showHidden: true, depth: null });
		for (const secret of [
			'private-prefix',
			'SECRET_DEFINED',
			'SECRET_UNDEFINED',
			'private-configuration-marker',
			'private-environment-marker',
			'unused-environment-marker'
		]) {
			expect(diagnostic).not.toContain(secret);
		}
		expect(input.auth.credentials.password).toBe(
			'private-prefix ${SECRET_DEFINED} ${SECRET_UNDEFINED}'
		);
		expect(env.SECRET_DEFINED).toBe('private-environment-marker');
	});
});
