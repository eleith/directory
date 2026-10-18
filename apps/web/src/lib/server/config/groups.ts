import type { DirectoryConfiguration, DirectoryLink, DirectorySite } from '@directory/config/types';
import type { DirectoryDisplay, DisplayGroup, DisplayLink } from '../../display/types.js';

const alphabeticalOrder = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export function getGroups(
	config: DirectoryConfiguration
): Pick<DirectoryDisplay, 'grouped' | 'groups'> {
	const order = config.site.order;
	const namedGroups = new Map<string, { id: string; label: string; links: DisplayLink[] }>();
	const ungroupedLinks: DisplayLink[] = [];

	for (const [id, configuredLink] of Object.entries(config.links)) {
		const link = prepareLink(id, configuredLink);
		const group = configuredLink.group;
		if (group === undefined) {
			ungroupedLinks.push(link);
			continue;
		}
		let namedGroup = namedGroups.get(group);
		if (namedGroup === undefined) {
			namedGroup = { id: `named:${group}`, label: group, links: [] };
			namedGroups.set(group, namedGroup);
		}
		namedGroup.links.push(link);
	}

	const grouped = namedGroups.size > 0;
	const orderedNamedGroups = Array.from(namedGroups.values());
	if (order === 'alphabetical') {
		orderedNamedGroups.sort((left, right) => alphabeticalOrder.compare(left.label, right.label));
	}
	const groups: DisplayGroup[] = orderedNamedGroups.map((group) => ({
		id: group.id,
		label: group.label,
		links: orderDisplayLinks(group.links, order)
	}));

	if (ungroupedLinks.length > 0) {
		const ungrouped: { id: string; label?: string; links: readonly DisplayLink[] } = {
			id: 'ungrouped',
			links: orderDisplayLinks(ungroupedLinks, order)
		};
		if (grouped) ungrouped.label = 'Other';
		groups.push(ungrouped);
	}
	return { grouped, groups };
}

function prepareLink(id: string, link: DirectoryLink): DisplayLink {
	const optionalFields: Pick<DirectoryLink, 'description' | 'logo_path' | 'favicon_path'> = {};
	if (link.description !== undefined) optionalFields.description = link.description;
	if (link.logo_path !== undefined) optionalFields.logo_path = link.logo_path;
	if (link.favicon_path !== undefined) optionalFields.favicon_path = link.favicon_path;
	return {
		id,
		title: link.title,
		url: link.url,
		...optionalFields,
		tags: getTagLabels(link),
		requires_auth: link.requires_auth,
		internal_only: link.internal_only,
		admin_only: link.admin_only
	};
}

function getTagLabels(link: DirectoryLink): string[] {
	return link.tags
		.split(',')
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0);
}

function orderDisplayLinks(
	links: readonly DisplayLink[],
	order: DirectorySite['order']
): DisplayLink[] {
	const orderedLinks = [...links];
	if (order === 'alphabetical') {
		orderedLinks.sort((left, right) => alphabeticalOrder.compare(left.title, right.title));
	}
	return orderedLinks;
}
