import { randomUUID } from 'node:crypto';
import type { WhereConfiguration } from '@where/config/types';
import type { DirectoryDisplay } from '../../display/types.js';
import { freezeData, type Immutable } from './immutable.js';
import { prepareDirectory } from './directory.js';

export interface PreparedSnapshot {
	readonly configuration: Immutable<WhereConfiguration>;
	readonly display: DirectoryDisplay;
	readonly assets: {
		readonly referencedPaths: readonly string[];
		readonly brandingPaths: readonly string[];
	};
}

export function prepareSnapshot(config: WhereConfiguration): PreparedSnapshot {
	const configuration = structuredClone(config);
	const display = prepareDirectory(configuration, randomUUID());
	const assets = collectAssetPaths(configuration);
	return freezeData({ configuration, display, assets });
}

function collectAssetPaths(config: WhereConfiguration): PreparedSnapshot['assets'] {
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
