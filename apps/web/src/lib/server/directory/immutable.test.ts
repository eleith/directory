import { describe, expect, expectTypeOf, it } from 'vitest';
import { freezeData } from './immutable.js';

describe('immutable owned snapshot data', () => {
	it('freezes every object and array while preserving values and optional absence', () => {
		const data = { title: 'Directory', links: [{ title: 'Photos', tags: ['photos', 'backup'] }] };
		const immutable = freezeData(data);
		expect(immutable).toBe(data);
		expect(immutable).toEqual({
			title: 'Directory',
			links: [{ title: 'Photos', tags: ['photos', 'backup'] }]
		});
		expect(Object.isFrozen(immutable)).toBe(true);
		expect(Object.isFrozen(immutable.links)).toBe(true);
		expect(Object.isFrozen(immutable.links[0])).toBe(true);
		expect(Object.isFrozen(immutable.links[0]?.tags)).toBe(true);
		expect(() => {
			Object.assign(immutable.links[0]!, { title: 'Changed' });
		}).toThrow(TypeError);
		expect(() => {
			(immutable.links as unknown[]).push({});
		}).toThrow(TypeError);
	});

	it.each([undefined, null, false, 0, ''])('leaves primitive data unchanged: %j', (value) => {
		expect(freezeData(value)).toBe(value);
	});

	it('keeps nested fields and arrays readonly at the type boundary', () => {
		const data = freezeData({ links: [{ title: 'Photos' }] });
		expectTypeOf(data).toEqualTypeOf<{
			readonly links: readonly { readonly title: string }[];
		}>();
	});
});
