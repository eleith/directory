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
		readonly bookmarkLogos: Readonly<Record<string, string>>;
	};
}

export function prepareSnapshot(config: DirectoryConfiguration): PreparedSnapshot {
	const configuration = structuredClone(config);
	const display = prepareDirectoryContent(configuration, randomUUID());
	const assets = {
		bookmarkLogos: renderBookmarkLogos(configuration)
	};
	return freezeData({ configuration, display, assets });
}
