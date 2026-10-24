import { ConfigError } from './errors.js';
import type { ConfigEnvironment } from './types.js';

const dollarEscapePattern = '\\$\\$';
const variableNamePattern = '[A-Z_][A-Z0-9_]*';
const fallbackTextPattern = '[^}]*';

// Dollar pairs are escapes; only an unpaired dollar can start an environment token.
export const environmentTokenPattern = `(?:^|[^$])(?:${dollarEscapePattern})*${buildTokenPattern(false)}`;

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

export function createInterpolationMatcher(): RegExp {
	return new RegExp(`${dollarEscapePattern}|${buildTokenPattern(true)}`, 'g');
}

function buildTokenPattern(captureValues: boolean): string {
	let variableName = variableNamePattern;
	let fallbackText = fallbackTextPattern;
	if (captureValues) {
		variableName = `(${variableName})`;
		fallbackText = `(${fallbackText})`;
	}
	return `\\$\\{${variableName}(?::-${fallbackText})?\\}`;
}

function interpolateString(
	value: string,
	env: ConfigEnvironment,
	path: string,
	missingPaths: Set<string>
): string {
	return value.replace(
		createInterpolationMatcher(),
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
	if (Array.isArray(node)) {
		return node.map((value, index) =>
			interpolateNode(value, env, `${path}/${index}`, missingPaths)
		);
	}
	if (typeof node !== 'object') return node;

	return Object.fromEntries(
		Object.entries(node as Record<string, unknown>).map(([key, value]) => {
			const segment = key.replace(/~/g, '~0').replace(/\//g, '~1');
			return [key, interpolateNode(value, env, `${path}/${segment}`, missingPaths)];
		})
	);
}
