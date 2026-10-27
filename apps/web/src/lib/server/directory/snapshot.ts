import { randomUUID } from 'node:crypto';
import type { DirectoryConfiguration } from '@directory/config/types';
import type { DirectoryContent } from '../../display/types.js';
import { freezeData, type Immutable } from './immutable.js';
import { prepareDirectoryContent } from './content.js';
import { renderBookmarkLogos } from '../images/render-bookmark-logos.js';

export interface PreparedSnapshot {
	readonly configuration: Immutable<DirectoryConfiguration>;
	readonly display: DirectoryContent;
	readonly assets: {
		readonly referencedPaths: readonly string[];
		readonly brandingPaths: readonly string[];
		readonly bookmarkLogos: Readonly<Record<string, string>>;
	};
}

export function prepareSnapshot(config: DirectoryConfiguration): PreparedSnapshot {
	const configuration = structuredClone(config);
	const display = prepareDirectoryContent(configuration, randomUUID());
	const assets = {
		...collectAssetPaths(configuration),
		bookmarkLogos: renderBookmarkLogos(configuration)
	};
	return freezeData({ configuration, display, assets });
}

function collectAssetPaths(
	config: DirectoryConfiguration
): Pick<PreparedSnapshot['assets'], 'referencedPaths' | 'brandingPaths'> {
	const brandingPaths = new Set<string>();
	for (const path of [config.site.logo_path, config.site.favicon_path, config.site.og_image_path]) {
		if (path?.startsWith('/public/')) brandingPaths.add(path);
	}
	const referencedPaths = new Set(brandingPaths);
	for (const link of Object.values(config.links)) {
		if (link.logo_path !== undefined) referencedPaths.add(link.logo_path);
	}
	return { referencedPaths: [...referencedPaths], brandingPaths: [...brandingPaths] };
}
