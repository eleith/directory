import { describe, expect, it, vi } from 'vitest';
import { ConfigError } from './errors.js';
import { assertSafeInput } from './input.js';

function rejects(value: unknown): void {
	expect(() => assertSafeInput(value)).toThrow(ConfigError);
}

describe('configuration input boundary', () => {
	it('accepts plain data and null-prototype maps without mutation', () => {
		const raw = {
			links: Object.assign(Object.create(null) as object, { photos: { title: 'Photos' } })
		};
		const before = JSON.stringify(raw);
		assertSafeInput(raw);
		expect(JSON.stringify(raw)).toBe(before);
	});

	it.each(
		[null, undefined, true, 1, 'text', [], new Date(), new Map(), new Set()].map((value) => [value])
	)('rejects a non-map root %j', rejects);

	it.each(
		[null, undefined, new Date(), new Map(), Infinity, NaN, 1n, Symbol('data'), () => 1].map(
			(value) => [value]
		)
	)('rejects unsupported nested data %#', (value) => rejects({ links: {}, extra: value }));

	it('accepts dense arrays and frozen arrays without mutation', () => {
		const tags = Object.freeze([' photos ', 'family, photos']);
		const raw = { links: { photos: { tags } }, values: [true, 1, { nested: [] }] };
		const before = JSON.stringify(raw);
		assertSafeInput(raw);
		expect(JSON.stringify(raw)).toBe(before);
	});

	it.each(
		[
			new Array(1),
			Object.assign(['photos'], { extra: true }),
			Object.assign(['photos'], { [Symbol('SENTINEL-array')]: true }),
			Object.defineProperty(['photos'], 'hidden', { value: true }),
			Object.setPrototypeOf(['photos'], null),
			[undefined],
			[null],
			[Infinity]
		].map((value) => ({ value }))
	)('rejects sparse, extended and unsupported array data %#', ({ value }) =>
		rejects({ links: { photos: { tags: value } } })
	);

	it('rejects array getters without evaluating them', () => {
		const getter = vi.fn(() => {
			throw new Error('SENTINEL-array-accessor');
		});
		const tags = Object.defineProperty([], '0', { enumerable: true, get: getter });
		rejects({ links: { photos: { tags } } });
		expect(getter).not.toHaveBeenCalled();
	});

	it('rejects array cycles while allowing shared array references', () => {
		const tags = ['photos'];
		assertSafeInput({ links: { photos: { tags }, files: { tags } } });
		const cyclic: unknown[] = [];
		cyclic.push(cyclic);
		rejects({ links: { photos: { tags: cyclic } } });
	});

	it.each(['__proto__', 'constructor', 'prototype'])(
		'rejects own unsafe keys before defaults can consume them: %s',
		(key) => {
			const raw = JSON.parse(`{"links":{},"site":{"${key}":{"polluted":true}}}`) as unknown;
			rejects(raw);
			expect({}).not.toHaveProperty('polluted');
		}
	);

	it('rejects a cycle but allows two references to the same plain object', () => {
		const shared = { title: 'Photos' };
		assertSafeInput({ links: { photos: shared, files: shared } });
		const cyclic: Record<string, unknown> = { links: {} };
		cyclic.self = cyclic;
		rejects(cyclic);
	});

	it('rejects getters without evaluating them', () => {
		const getter = vi.fn(() => {
			throw new Error('SENTINEL-accessor');
		});
		const raw = Object.defineProperty({ links: {} }, 'site', { enumerable: true, get: getter });
		rejects(raw);
		expect(getter).not.toHaveBeenCalled();
	});

	it('rejects symbol and hidden properties rather than dropping them', () => {
		rejects({ links: {}, [Symbol('SENTINEL-symbol')]: true });
		rejects(Object.defineProperty({ links: {} }, 'hidden', { value: true }));
	});

	it('redacts failures while reflecting on an array', () => {
		const tags = new Proxy([], {
			ownKeys: () => {
				throw new Error('SENTINEL-array-reflection');
			}
		});
		try {
			assertSafeInput({ links: { photos: { tags } } });
			throw new Error('Expected rejection');
		} catch (error) {
			expect(error).toBeInstanceOf(ConfigError);
			expect(String(error)).not.toContain('SENTINEL');
			expect(JSON.stringify(error)).not.toContain('SENTINEL');
		}
	});

	it('redacts failures while inspecting an unsupported object', () => {
		const raw = new Proxy(
			{},
			{
				getPrototypeOf: () => {
					throw new Error('SENTINEL-reflection');
				}
			}
		);
		try {
			assertSafeInput(raw);
			throw new Error('Expected rejection');
		} catch (error) {
			expect(error).toBeInstanceOf(ConfigError);
			expect(String(error)).not.toContain('SENTINEL');
			expect(JSON.stringify(error)).not.toContain('SENTINEL');
		}
	});
});
