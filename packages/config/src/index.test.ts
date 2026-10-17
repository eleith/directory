import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { configurationVersion, WhereConfigurationSchema } from '@where/config';
import type { WhereConfiguration } from '@where/config/types';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('@where/config compiled public module', () => {
	it('exports the supported configuration format as a literal', () => {
		expect(configurationVersion).toBe(1);
		expectTypeOf<typeof configurationVersion>().toEqualTypeOf<1>();
		expect(import.meta.resolve('@where/config')).toBe(
			new URL('../dist/index.js', import.meta.url).href
		);
	});

	it('exports the canonical schema and editor JSON at their compiled/artifact paths', () => {
		expect(WhereConfigurationSchema.properties.version.const).toBe(configurationVersion);
		expect(import.meta.resolve('@where/config/schema.json')).toBe(
			new URL('./config.schema.json', import.meta.url).href
		);
		expectTypeOf<WhereConfiguration['version']>().toEqualTypeOf<1>();
	});

	it('keeps the types entry free of runtime schema, format registration and loader imports', () => {
		const typesUrl = import.meta.resolve('@where/config/types');
		expect(typesUrl).toBe(new URL('../dist/types.js', import.meta.url).href);
		expect(readFileSync(new URL(typesUrl), 'utf8').trim()).toBe('export {};');
		const result = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'--eval',
				`
			const types = await import(${JSON.stringify(typesUrl)});
			const { FormatRegistry } = await import(${JSON.stringify(import.meta.resolve('@sinclair/typebox'))});
			console.log(JSON.stringify({ exports: Object.keys(types), registered: FormatRegistry.Has('where-http-url') }));
		`
			],
			{ encoding: 'utf8' }
		);
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({ exports: [], registered: false });
	});
});
