import type { DirectoryConfiguration, DirectoryLink } from '@directory/config/types';
import type { DirectoryDisplay, DisplayGroup, DisplayLink } from '../../display/types.js';

export function getGroups(
	config: DirectoryConfiguration
): Pick<DirectoryDisplay, 'grouped' | 'groups'> {
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
	const groups: DisplayGroup[] = Array.from(namedGroups.values()).map((group) => ({
		id: group.id,
		label: group.label,
		links: group.links
	}));

	if (ungroupedLinks.length > 0) {
		const ungrouped: { id: string; label?: string; links: readonly DisplayLink[] } = {
			id: 'ungrouped',
			links: ungroupedLinks
		};
		if (grouped) ungrouped.label = 'Other';
		groups.push(ungrouped);
	}
	return { grouped, groups };
}

function prepareLink(id: string, link: DirectoryLink): DisplayLink {
	const logoPath = link.logo_path ?? `/bookmarks/${id}/logo`;
	const optionalFields: Pick<DirectoryLink, 'description'> = {};
	if (link.description !== undefined) optionalFields.description = link.description;
	return {
		id,
		logo_path: logoPath,
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
	return link.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}
