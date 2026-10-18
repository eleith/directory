import type { DirectoryConfiguration, DirectorySite } from '@directory/config/types';
import type { DirectoryDisplay, DisplaySite } from '../../display/types.js';
import { getGroups } from './groups.js';
import { freezeData } from './immutable.js';

export function prepareDirectory(
	config: DirectoryConfiguration,
	snapshotId: string
): DirectoryDisplay {
	const site = getSite(config);
	const { grouped, groups } = getGroups(config);
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
	const optionalFields: Pick<DirectorySite, 'logo_path' | 'favicon_path'> = {};
	if (site.logo_path !== undefined) optionalFields.logo_path = site.logo_path;
	if (site.favicon_path !== undefined) optionalFields.favicon_path = site.favicon_path;
	return {
		title: site.title,
		description: site.description,
		footer: site.footer,
		...optionalFields
	};
}
