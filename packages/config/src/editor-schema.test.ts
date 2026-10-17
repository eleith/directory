import { readFileSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { createEditorSchema } from './editor-schema.js';
import { configurationReferences, WhereConfigurationSchema } from './schema.js';

type ObjectSchema = Record<string, unknown>;
const object = (value: unknown) => value as ObjectSchema;
const property = (schema: ObjectSchema, key: string) => object(object(schema.properties)[key]);
const definition = (schema: ObjectSchema, key: string) => object(object(schema.$defs)[key]);

describe('default-aware editor schema', () => {
	it('keeps links/title/URL/credentials required while relaxing loaded defaults', () => {
		const editor = createEditorSchema();
		expect(editor.required).toEqual(['links']);
		expect(definition(editor, 'Site').required).toBeUndefined();
		expect(definition(editor, 'Appearance').required).toBeUndefined();
		expect(definition(editor, 'Link').required).toEqual(['title', 'url']);
		expect(property(definition(editor, 'Link'), 'tags').default).toBe('');
		expect(definition(editor, 'Tags').type).toBe('string');
		expect(property(definition(editor, 'Link'), 'group').type).toBe('string');
		for (const flag of ['requires_auth', 'internal_only', 'admin_only']) {
			expect(property(definition(editor, 'Link'), flag)).toMatchObject({
				type: 'boolean',
				default: false
			});
		}
		expect(object(definition(editor, 'Site').properties)).not.toHaveProperty('group_by');
		expect(definition(editor, 'CredentialsAuth').required).toEqual(['username', 'password']);
		expect(definition(editor, 'OidcAuth').required).toEqual([
			'issuer',
			'client_id',
			'client_secret'
		]);
		const authBranches = definition(editor, 'Auth').anyOf as ObjectSchema[];
		expect(authBranches.map((branch) => branch.required)).toEqual([['oidc'], ['credentials']]);
		expect(authBranches.every((branch) => branch.additionalProperties === false)).toBe(true);
		expect(property(editor, 'links').additionalProperties).toBe(false);
		expect(definition(editor, 'HttpUrl').format).toBe('uri');
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

	it('matches the committed JSON artifact without mutating canonical schema', () => {
		const before = JSON.stringify([WhereConfigurationSchema, configurationReferences]);
		const editor = createEditorSchema();
		expect(
			JSON.parse(readFileSync(new URL('./config.schema.json', import.meta.url), 'utf8'))
		).toEqual(editor);
		expect(JSON.stringify([WhereConfigurationSchema, configurationReferences])).toBe(before);
		expect(createEditorSchema()).toEqual(editor);
	});

	it('walks map values, additional properties, arrays, unions and referenced defaults', () => {
		const namedDefault = Type.String({ $id: 'Text/with~default', default: 'ready' });
		const member = Type.Object({ title: Type.String(), enabled: Type.Boolean({ default: true }) });
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
		expect(object(property(editor, 'array').items).required).toEqual(['title']);
		expect(
			(property(editor, 'union').anyOf as ObjectSchema[]).map((branch) => branch.required)
		).toEqual([['title'], ['url']]);
		const additional = createEditorSchema(Type.Object({}, { additionalProperties: member }), []);
		expect(object(additional.additionalProperties).required).toEqual(['title']);
	});

	it('preserves annotation data rather than treating defaults as schemas', () => {
		const data = {
			required: ['keep'],
			properties: { keep: { default: 'annotation' } },
			$ref: 'literal-data',
			$id: 'literal-id'
		};
		const editor = createEditorSchema(Type.Object({ data: Type.Unknown({ default: data }) }), []);
		expect(property(editor, 'data').default).toEqual(data);
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
