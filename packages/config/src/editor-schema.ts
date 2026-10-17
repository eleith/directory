import type { TSchema } from '@sinclair/typebox';
import { configurationReferences, WhereConfigurationSchema } from './schema.js';

type SchemaObject = Record<string, unknown>;
type EditorContext = {
	root: SchemaObject;
	referenceTargets: ReadonlyMap<string, string>;
};

export function createEditorSchema(
	schema: TSchema = WhereConfigurationSchema,
	references: readonly TSchema[] = configurationReferences
): SchemaObject {
	const editorSchema = cloneSchema(schema);
	editorSchema.$schema = 'https://json-schema.org/draft/2020-12/schema';
	const referenceTargets = addDefinitions(editorSchema, references);
	const context: EditorContext = { root: editorSchema, referenceTargets };
	adaptSchemaForEditor(editorSchema, context);
	return editorSchema;
}

function isObject(value: unknown): value is SchemaObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneSchema(schema: TSchema): SchemaObject {
	return JSON.parse(JSON.stringify(schema)) as SchemaObject;
}

function addDefinitions(root: SchemaObject, references: readonly TSchema[]): Map<string, string> {
	const definitions: SchemaObject = Object.assign(
		Object.create(null) as SchemaObject,
		isObject(root.$defs) ? root.$defs : {}
	);
	const targets = new Map<string, string>();
	if (typeof root.$id === 'string' && root.$id) targets.set(root.$id, '#');
	for (const reference of references) {
		const id = reference.$id;
		if (!id || targets.has(id) || Object.hasOwn(definitions, id)) {
			throw new Error('Editor schema needs unique reference IDs');
		}
		definitions[id] = cloneSchema(reference);
		targets.set(id, `#/$defs/${id.replaceAll('~', '~0').replaceAll('/', '~1')}`);
	}
	if (Object.keys(definitions).length > 0) root.$defs = definitions;
	return targets;
}

function resolveReference(reference: string, context: EditorContext): SchemaObject {
	const pointer = context.referenceTargets.get(reference) ?? reference;
	if (pointer === '#') return context.root;
	if (!pointer.startsWith('#/')) throw new Error('Unresolved editor schema reference');
	let target: unknown = context.root;
	for (const part of pointer.slice(2).split('/')) {
		const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
		if (!isObject(target) || !Object.hasOwn(target, key)) {
			throw new Error('Unresolved editor schema reference');
		}
		target = target[key];
	}
	if (!isObject(target)) throw new Error('Unresolved editor schema reference');
	return target;
}

function hasDefault(
	node: unknown,
	context: EditorContext,
	seen = new Set<SchemaObject>()
): boolean {
	if (!isObject(node) || seen.has(node)) return false;
	if (Object.hasOwn(node, 'default')) return true;
	seen.add(node);
	return (
		typeof node.$ref === 'string' && hasDefault(resolveReference(node.$ref, context), context, seen)
	);
}

function removeDefaultedPropertiesFromRequired(node: SchemaObject, context: EditorContext): void {
	if (!Array.isArray(node.required) || !isObject(node.properties)) return;
	const properties = node.properties;
	const required = node.required.filter(
		(key: unknown) => typeof key === 'string' && !hasDefault(properties[key], context)
	);
	if (required.length === 0) delete node.required;
	else node.required = required;
}

function adaptSchemaForEditor(node: unknown, context: EditorContext): void {
	if (!isObject(node)) return;
	delete node.$id;
	if (typeof node.$ref === 'string') {
		resolveReference(node.$ref, context);
		node.$ref = context.referenceTargets.get(node.$ref) ?? node.$ref;
	}
	if (node.format === 'where-http-url') node.format = 'uri';
	removeDefaultedPropertiesFromRequired(node, context);
	for (const key of [
		'properties',
		'patternProperties',
		'$defs',
		'definitions',
		'dependentSchemas'
	]) {
		const children = node[key];
		if (isObject(children)) {
			for (const child of Object.values(children)) adaptSchemaForEditor(child, context);
		}
	}
	for (const key of [
		'additionalProperties',
		'additionalItems',
		'items',
		'contains',
		'propertyNames',
		'not',
		'if',
		'then',
		'else',
		'unevaluatedProperties',
		'unevaluatedItems',
		'allOf',
		'anyOf',
		'oneOf',
		'prefixItems'
	]) {
		const child = node[key];
		if (Array.isArray(child)) {
			for (const item of child) adaptSchemaForEditor(item, context);
		} else {
			adaptSchemaForEditor(child, context);
		}
	}
}
