import { ConfigError } from './errors.js';

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function assertSafeInput(raw: unknown): void {
	try {
		if (!isPlainObject(raw)) throw new ConfigError([{ code: 'invalid_shape', path: '/' }]);
		inspectValue(raw, '', new Set<object>());
	} catch (error) {
		if (error instanceof ConfigError) throw error;
		throw new ConfigError([{ code: 'invalid_shape', path: '/' }]);
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function inspectValue(value: unknown, path: string, ancestors: Set<object>): void {
	if (typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number' && Number.isFinite(value)) return;
	if (!isPlainObject(value) || ancestors.has(value)) {
		throw new ConfigError([{ code: 'invalid_shape', path }]);
	}
	ancestors.add(value);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const key of Reflect.ownKeys(descriptors)) {
		if (typeof key !== 'string') throw new ConfigError([{ code: 'invalid_shape', path }]);
		const childPath = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
		const descriptor = descriptors[key];
		if (unsafeKeys.has(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new ConfigError([{ code: 'invalid_shape', path: childPath }]);
		}
		inspectValue(descriptor.value, childPath, ancestors);
	}
	ancestors.delete(value);
}
