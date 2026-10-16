import { configurationVersion } from '@where/config';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('@where/config compiled public module', () => {
	it('exports the supported configuration format as a literal', () => {
		expect(configurationVersion).toBe(1);
		expectTypeOf<typeof configurationVersion>().toEqualTypeOf<1>();
		expect(import.meta.resolve('@where/config')).toBe(
			new URL('../dist/index.js', import.meta.url).href
		);
	});
});
