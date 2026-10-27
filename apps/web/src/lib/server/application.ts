import { isDeepStrictEqual } from 'node:util';
import { isSameConfiguration } from '@directory/config';
import type { DirectoryConfiguration } from '@directory/config/types';
import { createAuthentication, type Authentication } from './auth/index.js';
import { DirectoryError } from './directory-error.js';
import { prepareSnapshot } from './directory/snapshot.js';
import { reportDirectoryIssue } from './logger.js';

export type Application = ReturnType<typeof createApplication> & {
	readonly publicDir: string;
	stop(): void;
};

export interface ServerState {
	application: Application | undefined;
}

export function createApplication(initial: DirectoryConfiguration) {
	let snapshot = prepare(initial);
	let authentication: Authentication | undefined;
	try {
		const auth = snapshot.configuration.auth;
		if (auth !== undefined) {
			authentication = createAuthentication({ ...auth, origin: snapshot.configuration.site.url });
		}
	} catch {
		throw new DirectoryError({ code: 'auth_failed' });
	}

	return {
		currentSnapshot: () => snapshot,
		authentication,
		onConfigChange(next: DirectoryConfiguration, previous: DirectoryConfiguration): boolean {
			if (!isDeepStrictEqual(startupSettings(next), startupSettings(previous))) {
				reportDirectoryIssue({ code: 'restart_required' });
				return false;
			}
			if (isSameConfiguration(next, previous)) return true;
			snapshot = prepare(next);
			return true;
		}
	};
}

function startupSettings(config: DirectoryConfiguration) {
	return { siteUrl: config.site.url, auth: config.auth };
}

function prepare(config: DirectoryConfiguration) {
	try {
		return prepareSnapshot(config);
	} catch {
		throw new DirectoryError({ code: 'prepare_failed' });
	}
}
