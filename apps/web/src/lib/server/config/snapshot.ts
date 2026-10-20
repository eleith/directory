import { randomUUID } from 'node:crypto';
import type { DirectoryConfiguration } from '@directory/config/types';
import type { DirectoryDisplay } from '../../display/types.js';
import { freezeData, type Immutable } from './immutable.js';
import { prepareDirectory } from './directory.js';
import { getBookmarkLogos } from '../bookmark-logos.js';

export interface PreparedSnapshot {
	readonly configuration: Immutable<DirectoryConfiguration>;
	readonly display: DirectoryDisplay;
	readonly assets: {
		readonly referencedPaths: readonly string[];
		readonly brandingPaths: readonly string[];
		readonly bookmarkLogos: Readonly<Record<string, string>>;
	};
}

export function prepareSnapshot(config: DirectoryConfiguration): PreparedSnapshot {
	const configuration = structuredClone(config);
	const display = prepareDirectory(configuration, randomUUID());
	const assets = {
		...collectAssetPaths(configuration),
		bookmarkLogos: getBookmarkLogos(configuration)
	};
	return freezeData({ configuration, display, assets });
}

function collectAssetPaths(
	config: DirectoryConfiguration
): Pick<PreparedSnapshot['assets'], 'referencedPaths' | 'brandingPaths'> {
	const brandingPaths = new Set<string>();
	for (const path of [config.site.logo_path, config.site.favicon_path]) {
		if (path !== undefined) brandingPaths.add(path);
	}
	const referencedPaths = new Set(brandingPaths);
	for (const link of Object.values(config.links)) {
		for (const path of [link.logo_path, link.favicon_path]) {
			if (path !== undefined) referencedPaths.add(path);
		}
	}
	return { referencedPaths: [...referencedPaths], brandingPaths: [...brandingPaths] };
}
