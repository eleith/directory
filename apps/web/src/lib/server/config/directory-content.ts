import type { DirectoryConfiguration } from '@directory/config/types';
import type { DirectoryContent, DisplaySite } from '../../display/types.js';
import { prepareBookmarkGroups } from './bookmark-groups.js';
import { freezeData } from './immutable.js';

export function prepareDirectoryContent(
	config: DirectoryConfiguration,
	snapshotId: string
): DirectoryContent {
	const site = getSite(config);
	const { grouped, groups } = prepareBookmarkGroups(config);
	return freezeData({
		snapshotId,
		site,
		appearance: {
			primary_light_color: config.appearance.primary_light_color,
			primary_dark_color: config.appearance.primary_dark_color
		},
		grouped,
		groups
	});
}

export function getSite(config: DirectoryConfiguration): DisplaySite {
	const site = config.site;
	return {
		title: site.title,
		description: site.description,
		footer: site.footer,
		logo_path: site.logo_path,
		favicon_path: site.favicon_path,
		open_links_in_new_tab: site.open_links_in_new_tab
	};
}
