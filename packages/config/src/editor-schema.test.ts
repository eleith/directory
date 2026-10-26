import { readFileSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { createEditorSchema } from './editor-schema.js';
import {
	configurationReferences,
	HexColorSchema,
	HttpUrlSchema,
	AuthOriginSchema,
	LocalImagePathSchema,
	DirectoryConfigurationSchema
} from './schema.js';

type ObjectSchema = Record<string, unknown>;
const object = (value: unknown) => value as ObjectSchema;
const property = (schema: ObjectSchema, key: string) => object(object(schema.properties)[key]);
const definition = (schema: ObjectSchema, key: string) => object(object(schema.$defs)[key]);

function interpolationPattern(schema: ObjectSchema): RegExp {
	const branches = schema.anyOf as ObjectSchema[];
	expect(branches).toHaveLength(2);
	expect(branches[1]).toEqual({ type: 'string', pattern: expect.any(String) });
	return new RegExp(String(branches[1]!.pattern));
}

describe('default-aware editor schema', () => {
	it('keeps links/title/URL/credentials required while relaxing loaded defaults', () => {
		const editor = createEditorSchema();
		expect(editor.required).toEqual(['links']);
		expect(definition(editor, 'Site').required).toBeUndefined();
		expect(definition(editor, 'Appearance').required).toBeUndefined();
		expect(definition(editor, 'Link').required).toEqual(['title', 'url']);
		expect(property(definition(editor, 'Link'), 'tags').default).toEqual([]);
		expect(definition(editor, 'Tags').type).toBe('array');
		const tagItem = object(definition(editor, 'Tags').items);
		expect(tagItem.type).toBe('string');
		expect(interpolationPattern(tagItem).test('${TAG}')).toBe(true);
		expect(property(definition(editor, 'Link'), 'group').type).toBe('string');
		for (const flag of ['requires_auth', 'internal_only', 'admin_only']) {
			expect(property(definition(editor, 'Link'), flag)).toMatchObject({
				type: 'boolean',
				default: false
			});
		}
		expect(property(definition(editor, 'Site'), 'open_links_in_new_tab')).toMatchObject({
			type: 'boolean',
			default: true
		});
		expect(property(definition(editor, 'Site'), 'open_links_in_new_tab')).not.toHaveProperty(
			'anyOf'
		);
		expect(object(definition(editor, 'Link').properties)).not.toHaveProperty(
			'open_links_in_new_tab'
		);
		expect(object(definition(editor, 'Site').properties)).not.toHaveProperty('group_by');
		expect(object(definition(editor, 'Site').properties)).not.toHaveProperty('order');
		expect(definition(editor, 'CredentialsAuth').required).toEqual(['username', 'password']);
		expect(definition(editor, 'OidcAuth').required).toEqual([
			'issuer',
			'client_id',
			'client_secret'
		]);
		const authBranches = definition(editor, 'Auth').anyOf as ObjectSchema[];
		expect(authBranches.map((branch) => branch.required)).toEqual([
			['origin', 'oidc'],
			['origin', 'credentials']
		]);
		expect(authBranches.every((branch) => branch.additionalProperties === false)).toBe(true);
		expect(property(editor, 'links').additionalProperties).toBe(false);
		expect(object((definition(editor, 'HttpUrl').anyOf as unknown[])[0]).format).toBe('uri');
	});

	it('keeps auth origin required and secret optional, constrained and without defaults', () => {
		const editor = createEditorSchema();
		for (const branch of definition(editor, 'Auth').anyOf as ObjectSchema[]) {
			expect(property(branch, 'origin')).toEqual({ $ref: '#/$defs/AuthOrigin' });
			expect(property(branch, 'secret')).toEqual({ $ref: '#/$defs/AuthSecret' });
			expect(branch.required).not.toContain('secret');
		}
		const origin = definition(editor, 'AuthOrigin');
		const secret = definition(editor, 'AuthSecret');
		expect(secret).not.toHaveProperty('default');
		expect((secret.anyOf as ObjectSchema[])[0]).toEqual({
			type: 'string',
			minLength: 32,
			pattern: '\\S'
		});
		expect(interpolationPattern(origin).test('${PUBLIC_ORIGIN}')).toBe(true);
		expect(interpolationPattern(secret).test('${SECRET:-fallback}')).toBe(true);
	});

	it('keeps site image defaults on references without broadening bookmark image choices', () => {
		const editor = createEditorSchema();
		for (const field of ['logo_path', 'favicon_path']) {
			expect(property(definition(editor, 'Site'), field)).toEqual({
				$ref: '#/$defs/SiteImagePath',
				default: '/favicon.svg'
			});
		}
		expect(property(definition(editor, 'Link'), 'logo_path')).toEqual({
			$ref: '#/$defs/LocalImagePath'
		});
		expect(object(definition(editor, 'Link').properties)).not.toHaveProperty('favicon_path');
		const choices = definition(editor, 'SiteImagePath').anyOf as ObjectSchema[];
		expect(choices[0]).toEqual({ $ref: '#/$defs/LocalImagePath' });
		expect((choices[1]!.anyOf as ObjectSchema[])[0]).toEqual({
			type: 'string',
			const: '/favicon.svg'
		});
		expect(interpolationPattern(choices[1]!).test('${SITE_IMAGE}')).toBe(true);
	});

	it('produces only resolvable local references, with no invented publication URL', () => {
		const editor = createEditorSchema();
		expect(editor.$id).toBeUndefined();
		let references = 0;
		function inspect(value: unknown): void {
			if (typeof value !== 'object' || value === null) return;
			if (Array.isArray(value)) {
				value.forEach(inspect);
				return;
			}
			const node = object(value);
			expect(node.$id).toBeUndefined();
			if (typeof node.$ref === 'string') {
				references++;
				expect(node.$ref.startsWith('#/$defs/')).toBe(true);
				const key = node.$ref.slice('#/$defs/'.length).replaceAll('~1', '/').replaceAll('~0', '~');
				expect(object(editor.$defs)[key]).toBeDefined();
			}
			Object.values(node).forEach(inspect);
		}
		inspect(editor);
		expect(references).toBeGreaterThan(10);
	});

	it('matches the committed JSON artifact', () => {
		expect(
			JSON.parse(readFileSync(new URL('./config.schema.json', import.meta.url), 'utf8'))
		).toEqual(createEditorSchema());
	});

	it('does not mutate canonical schemas and produces repeatable output', () => {
		const before = JSON.stringify([DirectoryConfigurationSchema, configurationReferences]);
		const editor = createEditorSchema();
		expect(JSON.stringify([DirectoryConfigurationSchema, configurationReferences])).toBe(before);
		expect(createEditorSchema()).toEqual(editor);
	});

	it('walks map values, additional properties, arrays, unions and referenced defaults', () => {
		const namedDefault = Type.String({ $id: 'Text/with~default', default: 'ready' });
		const member = Type.Object({
			title: Type.String({ pattern: '\\S' }),
			enabled: Type.Boolean({ default: true })
		});
		const fixture = Type.Object({
			text: Type.Unsafe<string>(Type.Ref(namedDefault.$id!)),
			map: Type.Record(Type.String(), member),
			array: Type.Array(member),
			union: Type.Union([
				member,
				Type.Object({ url: Type.String(), count: Type.Number({ default: 0 }) })
			])
		});
		const editor = createEditorSchema(fixture, [namedDefault]);
		expect(editor.required).toEqual(['map', 'array', 'union']);
		expect(property(editor, 'text').$ref).toBe('#/$defs/Text~1with~0default');
		expect(
			object(Object.values(object(property(editor, 'map').patternProperties))[0]).required
		).toEqual(['title']);
		const arrayMember = object(property(editor, 'array').items);
		expect(arrayMember.required).toEqual(['title']);
		expect(interpolationPattern(property(arrayMember, 'title')).test('${TITLE}')).toBe(true);
		expect(
			(property(editor, 'union').anyOf as ObjectSchema[]).map((branch) => branch.required)
		).toEqual([['title'], ['url']]);
		const unionMember = (property(editor, 'union').anyOf as ObjectSchema[])[0]!;
		expect(interpolationPattern(property(unionMember, 'title')).test('${TITLE}')).toBe(true);
		const additional = createEditorSchema(Type.Object({}, { additionalProperties: member }), []);
		expect(object(additional.additionalProperties).required).toEqual(['title']);
		expect(
			interpolationPattern(property(object(additional.additionalProperties), 'title')).test(
				'${TITLE}'
			)
		).toBe(true);
	});

	it('preserves annotation data rather than treating defaults as schemas', () => {
		const data = {
			required: ['keep'],
			properties: { keep: { default: 'annotation' } },
			$ref: 'literal-data',
			$id: 'literal-id',
			type: 'string',
			pattern: 'literal-pattern',
			const: 'literal-constant',
			anyOf: [{ type: 'string', pattern: 'annotation-pattern' }]
		};
		const editor = createEditorSchema(Type.Object({ data: Type.Unknown({ default: data }) }), []);
		expect(property(editor, 'data').default).toEqual(data);
	});

	it('separates literal constraints from the environment-token branch', () => {
		const editor = createEditorSchema();
		for (const canonical of [
			HttpUrlSchema,
			AuthOriginSchema,
			LocalImagePathSchema,
			HexColorSchema
		]) {
			const adapted = definition(editor, canonical.$id!);
			const literal: ObjectSchema = { type: 'string', pattern: canonical.pattern };
			if (canonical.format) literal.format = 'uri';
			expect(adapted.anyOf).toEqual([literal, { type: 'string', pattern: expect.any(String) }]);
			expect(adapted.pattern).toBeUndefined();
			expect(adapted.format).toBeUndefined();
			expect(adapted.description).toBe(canonical.description);
		}
		const fixture = Type.Object({
			choice: Type.Union([Type.Literal('first'), Type.Literal('second')], {
				default: 'first',
				description: 'A string choice.'
			})
		});
		const choice = property(createEditorSchema(fixture, []), 'choice');
		expect(choice.default).toBe('first');
		expect(choice.description).toBe('A string choice.');
		const choices = choice.anyOf as ObjectSchema[];
		expect(choices.map((branch) => (branch.anyOf as ObjectSchema[])[0])).toEqual([
			{ type: 'string', const: 'first' },
			{ type: 'string', const: 'second' }
		]);
		for (const branch of choices) {
			expect(branch.const).toBeUndefined();
			expect(interpolationPattern(branch).test('${CHOICE:-first}')).toBe(true);
		}
	});

	it.each([
		'${HOST}',
		'${_HOST_2}',
		'${HOST:-}',
		'${HOST:-literal fallback}',
		'${HOST:-line one\nline two}',
		'${HOST:-${OTHER}}',
		'prefix ${HOST} suffix',
		'$$${HOST}',
		'$$$$${HOST}',
		'$${ESCAPED} then ${HOST}',
		'javascript:${CODE}',
		'${HOST:-javascript:alert(1)}'
	])('recognizes a supported unescaped token in %j', (value) => {
		const editor = createEditorSchema();
		for (const name of ['HttpUrl', 'LocalImagePath', 'HexColor']) {
			expect(interpolationPattern(definition(editor, name)).test(value)).toBe(true);
		}
	});

	it.each([
		'',
		'${host}',
		'${1HOST}',
		'${HÖST}',
		'${HOST.NAME}',
		'${HOST-NAME}',
		'${ HOST}',
		'${HOST:default}',
		'${HOST-default}',
		'${HOST:=default}',
		'${HOST',
		'$HOST',
		'$${HOST}',
		'$$$${HOST}',
		'$$$$$${HOST}',
		'prefix $${HOST:-fallback}',
		'javascript:alert(1)',
		'javascript:$${CODE}',
		'data:text/html,test',
		'file:///etc/passwd',
		'/relative',
		'https://',
		'https://[broken'
	])('does not grant the placeholder exception to %j', (value) => {
		const editor = createEditorSchema();
		for (const name of ['HttpUrl', 'LocalImagePath', 'HexColor']) {
			expect(interpolationPattern(definition(editor, name)).test(value)).toBe(false);
		}
	});

	it('relaxes constrained string leaves while preserving types, annotations and falsy defaults', () => {
		const examples = [{ type: 'string', const: 'annotation', $ref: 'literal' }];
		const fixture = Type.Object({
			choice: Type.String({ enum: ['first', 'second'], default: '', examples }),
			constant: Type.Literal('fixed'),
			text: Type.String(),
			limited: Type.String({ minLength: 2, maxLength: 5, title: 'Limited text' }),
			flag: Type.Boolean({ default: false }),
			count: Type.Number({ default: 0 }),
			version: Type.Literal(1)
		});
		const editor = createEditorSchema(fixture, []);
		expect(editor.required).toEqual(['constant', 'text', 'limited', 'version']);
		expect(property(editor, 'choice')).toMatchObject({ default: '', examples });
		expect((property(editor, 'choice').anyOf as ObjectSchema[])[0]).toEqual({
			type: 'string',
			enum: ['first', 'second']
		});
		expect((property(editor, 'constant').anyOf as ObjectSchema[])[0]).toEqual({
			type: 'string',
			const: 'fixed'
		});
		expect(property(editor, 'text')).toEqual({ type: 'string' });
		expect(property(editor, 'limited').title).toBe('Limited text');
		expect((property(editor, 'limited').anyOf as ObjectSchema[])[0]).toEqual({
			type: 'string',
			minLength: 2,
			maxLength: 5
		});
		expect(property(editor, 'flag')).toEqual({ type: 'boolean', default: false });
		expect(property(editor, 'count')).toEqual({ type: 'number', default: 0 });
		expect(property(editor, 'version')).toEqual({ type: 'number', const: 1 });
	});

	it('keeps object-key and slug-map constraints literal while relaxing their values', () => {
		const value = Type.String({ pattern: '^ready$' });
		const editor = createEditorSchema(
			Type.Record(Type.String({ pattern: '^[a-z]+$' }), value, {
				propertyNames: Type.String({ pattern: '^allowed$', enum: ['allowed'] }),
				additionalProperties: false
			}),
			[]
		);
		expect(editor.propertyNames).toEqual({
			type: 'string',
			pattern: '^allowed$',
			enum: ['allowed']
		});
		expect(Object.keys(object(editor.patternProperties))).toEqual(['^[a-z]+$']);
		expect(editor.additionalProperties).toBe(false);
		expect(
			interpolationPattern(object(object(editor.patternProperties)['^[a-z]+$'])).test('${VALUE}')
		).toBe(true);
		const links = property(createEditorSchema(), 'links');
		const canonicalLinks = DirectoryConfigurationSchema.properties.links;
		expect(Object.keys(object(links.patternProperties))).toEqual(
			Object.keys(canonicalLinks.patternProperties)
		);
		for (const pattern of Object.keys(object(links.patternProperties))) {
			expect(new RegExp(pattern).test('${SLUG}')).toBe(false);
		}
	});

	it('leaves canonical validation strict for placeholders and expanded values', () => {
		for (const schema of [HttpUrlSchema, AuthOriginSchema, LocalImagePathSchema, HexColorSchema]) {
			expect(Value.Check(schema, '${VALUE}')).toBe(false);
			expect(Value.Check(schema, false)).toBe(false);
			expect(Value.Check(schema, 1)).toBe(false);
		}
		for (const url of ['javascript:alert(1)', 'https://', 'https://[broken']) {
			expect(Value.Check(HttpUrlSchema, url)).toBe(false);
		}
		expect(Value.Check(HttpUrlSchema, 'https://example.com')).toBe(true);
		expect(Value.Check(LocalImagePathSchema, '/public/../logo.svg')).toBe(false);
		expect(Value.Check(LocalImagePathSchema, '/public/logo.svg')).toBe(true);
		expect(Value.Check(HexColorSchema, 'red')).toBe(false);
		expect(Value.Check(HexColorSchema, '#abc')).toBe(true);
	});

	it('rejects missing/duplicate IDs and dangling references', () => {
		expect(() => createEditorSchema(Type.Ref('Missing'), [])).toThrow(
			'Unresolved editor schema reference'
		);
		expect(() => createEditorSchema(Type.Object({}), [Type.String()])).toThrow(
			'unique reference IDs'
		);
		expect(() =>
			createEditorSchema(Type.Object({}), [
				Type.String({ $id: 'Same' }),
				Type.Number({ $id: 'Same' })
			])
		).toThrow('unique reference IDs');
	});

	it('terminates reference cycles without making non-defaulted fields optional', () => {
		const first = Type.Ref('Second', { $id: 'First' });
		const second = Type.Ref('First', { $id: 'Second' });
		const editor = createEditorSchema(Type.Object({ value: Type.Ref('First') }), [first, second]);
		expect(editor.required).toEqual(['value']);
	});
});
