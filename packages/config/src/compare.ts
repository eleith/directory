import { isDeepStrictEqual } from 'node:util';
import type { DirectoryConfiguration } from './types.js';

export function isSameConfiguration(
	next: DirectoryConfiguration,
	previous: DirectoryConfiguration
): boolean {
	const sameValues = isDeepStrictEqual(next, previous);
	// Bookmark declaration order determines display order, unlike other mapping keys.
	const sameLinkOrder = isDeepStrictEqual(Object.keys(next.links), Object.keys(previous.links));
	return sameValues && sameLinkOrder;
}
