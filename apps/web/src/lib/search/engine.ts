import Fuse from 'fuse.js';
import type { DirectoryContent, DisplayLink } from '$lib/display/types.js';

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

export function createSearch(directory: DirectoryContent) {
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
		const foldedQuery = trimmedQuery.toLowerCase();
		if (foldedQuery.startsWith('tag:')) {
			const tag = foldedQuery.slice(4).trim();
			if (!tag) return [];
			return documents
				.filter((document) => document.tags.some((label) => label.toLowerCase() === tag))
				.map((document) => document.result);
		}
		if (foldedQuery.startsWith('access:')) {
			const access = foldedQuery.slice(7).trim();
			return documents
				.filter(({ result }) => {
					if (access === 'login') return result.link.requires_auth === true;
					if (access === 'internal') return result.link.internal_only === true;
					if (access === 'admin') return result.link.admin_only === true;
					return false;
				})
				.map((document) => document.result);
		}
		return index.search(trimmedQuery).map((match) => match.item.result);
	};
}
