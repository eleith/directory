import { ConfigError } from './errors.js';
import type { ConfigEnvironment } from './types.js';

export function interpolate<T>(node: T, env: ConfigEnvironment): T {
	const missingPaths = new Set<string>();
	const result = interpolateNode(node, env, '', missingPaths);
	if (missingPaths.size > 0) {
		throw new ConfigError(
			[...missingPaths].sort().map((path) => ({ code: 'missing_environment', path }))
		);
	}
	return result as T;
}

function interpolateString(
	value: string,
	env: ConfigEnvironment,
	path: string,
	missingPaths: Set<string>
): string {
	return value.replace(
		/\$\$|\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g,
		(match, name: string | undefined, fallback: string | undefined) => {
			if (match === '$$') return '$';
			let replacement: string | undefined;
			if (name !== undefined && Object.hasOwn(env, name)) replacement = env[name];
			if (replacement !== undefined) return replacement;
			if (fallback !== undefined) return fallback;
			missingPaths.add(path || '/');
			return '';
		}
	);
}

function interpolateNode(
	node: unknown,
	env: ConfigEnvironment,
	path: string,
	missingPaths: Set<string>
): unknown {
	if (typeof node === 'string') return interpolateString(node, env, path, missingPaths);
	if (typeof node !== 'object') return node;

	return Object.fromEntries(
		Object.entries(node as Record<string, unknown>).map(([key, value]) => {
			const segment = key.replace(/~/g, '~0').replace(/\//g, '~1');
			return [key, interpolateNode(value, env, `${path}/${segment}`, missingPaths)];
		})
	);
}
