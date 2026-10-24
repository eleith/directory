import { inspect } from 'node:util';
import { Type } from '@sinclair/typebox';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createEditorSchema } from './editor-schema.js';
import { ConfigError } from './errors.js';
import type { ConfigEnvironment } from './types.js';
import { createInterpolationMatcher, interpolate } from './interpolate.js';

function missingEnvironmentError(node: unknown, env: ConfigEnvironment = {}): ConfigError {
	try {
		interpolate(node, env);
	} catch (error) {
		if (error instanceof ConfigError) return error;
		throw error;
	}
	throw new Error('Expected missing environment variables');
}

function editorTokenMatcher(): RegExp {
	const schema = createEditorSchema(Type.String({ minLength: 1 }), []);
	const tokenBranch = (schema.anyOf as { pattern: string }[])[1]!;
	return new RegExp(tokenBranch.pattern);
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

	it('preserves array shape and interpolates values without mutating authored lists', () => {
		const tags = Object.freeze(['${TAG}', 'family, photos', '$${LITERAL}']);
		const input = Object.freeze({ links: Object.freeze({ photos: Object.freeze({ tags }) }) });
		const result = interpolate(input, { TAG: 'Photos' });
		expect(result.links.photos.tags).toEqual(['Photos', 'family, photos', '${LITERAL}']);
		expect(Array.isArray(result.links.photos.tags)).toBe(true);
		expect(result.links.photos.tags).not.toBe(tags);
		expect(input.links.photos.tags).toEqual(['${TAG}', 'family, photos', '$${LITERAL}']);
		expect(
			missingEnvironmentError({ links: { photos: { tags: ['${MISSING}'] } } }).issues
		).toMatchObject([{ code: 'missing_environment', path: '/links/*/tags/*' }]);
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

describe('shared interpolation syntax', () => {
	const environment = { HOST: 'home.example', _HOST_2: 'backup.example', EMPTY: '' };

	it.each([
		{ input: '${HOST}', output: 'home.example', hasToken: true },
		{ input: '${_HOST_2}', output: 'backup.example', hasToken: true },
		{ input: 'prefix ${HOST} suffix', output: 'prefix home.example suffix', hasToken: true },
		{ input: '${MISSING:-fallback}', output: 'fallback', hasToken: true },
		{ input: '${MISSING:-}', output: '', hasToken: true },
		{ input: '${EMPTY:-fallback}', output: '', hasToken: true },
		{ input: '${MISSING:-line one\nline two}', output: 'line one\nline two', hasToken: true },
		{ input: '${MISSING:-${HOST}}', output: '${HOST}', hasToken: true },
		{ input: '${HOST}${HOST}', output: 'home.examplehome.example', hasToken: true },
		{ input: '$$', output: '$', hasToken: false },
		{ input: '$${HOST}', output: '${HOST}', hasToken: false },
		{ input: '$$${HOST}', output: '$home.example', hasToken: true },
		{ input: '$$$${HOST}', output: '$${HOST}', hasToken: false },
		{ input: '$$$$${HOST}', output: '$$home.example', hasToken: true },
		{ input: '$${ESCAPED} then ${HOST}', output: '${ESCAPED} then home.example', hasToken: true },
		{ input: '${host}', output: '${host}', hasToken: false },
		{ input: '${HOST-NAME}', output: '${HOST-NAME}', hasToken: false },
		{ input: '${HOST:-unterminated', output: '${HOST:-unterminated', hasToken: false },
		{ input: '$HOST', output: '$HOST', hasToken: false }
	])(
		'aligns runtime replacement and editor recognition for $input',
		({ input, output, hasToken }) => {
			expect(interpolate(input, environment)).toBe(output);
			expect(editorTokenMatcher().test(input)).toBe(hasToken);
		}
	);

	it('keeps missing recognized variables as errors', () => {
		expect(editorTokenMatcher().test('${MISSING}')).toBe(true);
		expect(() => interpolate('${MISSING}', {})).toThrow(ConfigError);
	});

	it('captures runtime values without sharing mutable matcher state', () => {
		const matcher = createInterpolationMatcher();
		const matches = Array.from('${HOST} $$ ${MISSING:-fallback}'.matchAll(matcher), (match) => [
			match[0],
			match[1],
			match[2]
		]);
		expect(matches).toEqual([
			['${HOST}', 'HOST', undefined],
			['$$', undefined, undefined],
			['${MISSING:-fallback}', 'MISSING', 'fallback']
		]);
		expect(createInterpolationMatcher()).not.toBe(matcher);
	});
});
