import { readFile } from 'node:fs/promises';
import { Value } from '@sinclair/typebox/value';
import { parseAllDocuments } from 'yaml';
import { ConfigError, type ConfigIssue } from './errors.js';
import { assertSafeInput } from './input.js';
import { interpolate } from './interpolate.js';
import { resolveConfigPath } from './paths.js';
import { configurationReferences, WhereConfigurationSchema } from './schema.js';
import type { ConfigLoadOptions, WhereConfiguration } from './types.js';

export async function loadConfigFile(
	path?: string,
	options: ConfigLoadOptions = {}
): Promise<WhereConfiguration> {
	let source: string;
	try {
		const configPath = path ?? resolveConfigPath(options);
		source = await readFile(configPath, 'utf8');
	} catch {
		throw new ConfigError([{ code: 'file_unreadable', path: '/' }]);
	}
	const raw = parseConfigurationYaml(source);
	return validateConfig(raw, options);
}

export function validateConfig(raw: unknown, options: ConfigLoadOptions = {}): WhereConfiguration {
	assertSafeInput(raw);
	try {
		const copy: unknown = structuredClone(raw);
		const defaulted: unknown = Value.Default(
			WhereConfigurationSchema,
			[...configurationReferences],
			copy
		);
		const expanded = interpolate(defaulted, options.env ?? process.env);
		return checkSchema(expanded);
	} catch (error) {
		if (error instanceof ConfigError) throw error;
		throw new ConfigError([{ code: 'invalid_value', path: '/' }]);
	}
}

function parseConfigurationYaml(source: string): unknown {
	try {
		const documents = parseAllDocuments(source, {
			version: '1.2',
			schema: 'core',
			stringKeys: true,
			uniqueKeys: true,
			merge: false,
			prettyErrors: false,
			logLevel: 'silent'
		});
		const document = documents[0];
		if (
			documents.length !== 1 ||
			!document ||
			document.errors.length > 0 ||
			document.warnings.length > 0 ||
			document.directives?.yaml.version !== '1.2'
		) {
			throw new ConfigError([{ code: 'invalid_yaml', path: '/' }]);
		}
		return document.toJS({ maxAliasCount: 100 });
	} catch (error) {
		if (error instanceof ConfigError) throw error;
		throw new ConfigError([{ code: 'invalid_yaml', path: '/' }]);
	}
}

function checkSchema(value: unknown): WhereConfiguration {
	const locations: Pick<ConfigIssue, 'code' | 'path'>[] = [];
	for (const error of Value.Errors(WhereConfigurationSchema, [...configurationReferences], value)) {
		locations.push({ code: 'invalid_value', path: error.path });
	}
	if (locations.length > 0) throw new ConfigError(locations);
	return value as WhereConfiguration;
}
