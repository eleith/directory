import Fuse from 'fuse.js';
import type { DirectoryDisplay, DisplayLink } from '$lib/display/types.js';

export interface SearchResult {
	readonly link: DisplayLink;
	readonly groupLabel: string | undefined;
}

interface SearchDocument {
	readonly title: string;
	readonly tags: readonly string[];
	readonly description: string;
	readonly publicText: readonly string[];
	readonly result: SearchResult;
}

export function createSearch(directory: DirectoryDisplay) {
	const documents: SearchDocument[] = [];
	for (const group of directory.groups) {
		for (const link of group.links) {
			const publicText = [link.id, link.url];
			if (group.label) publicText.push(group.label);
			if (link.requires_auth) publicText.push('Requires authentication');
			if (link.internal_only) publicText.push('Internal only');
			if (link.admin_only) publicText.push('Admin only');
			documents.push({
				title: link.title,
				tags: link.tags,
				description: link.description ?? '',
				publicText,
				result: { link, groupLabel: group.label }
			});
		}
	}

	const index = new Fuse(documents, {
		useTokenSearch: true,
		tokenMatch: 'all',
		ignoreLocation: true,
		threshold: 0.35,
		keys: [
			{ name: 'title', weight: 4 },
			{ name: 'tags', weight: 3 },
			{ name: 'description', weight: 2 },
			{ name: 'publicText', weight: 1 }
		]
	});

	return (query: string): SearchResult[] => {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) return [];
		return index.search(trimmedQuery).map((match) => match.item.result);
	};
}
