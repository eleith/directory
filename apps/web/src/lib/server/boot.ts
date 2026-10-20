import { resolveConfigPath, resolvePublicDir } from '@directory/config';
import type { ConfigEnvironment } from '@directory/config/types';
import { createAuthentication, type Authentication } from './auth/index.js';
import { AuthSettingsError } from './auth/settings.js';
import { DirectoryError, loadDirectory, type Directory } from './config/load-directory.js';
import type { Application } from './lifecycle/application.js';
import { watchConfig } from './config/watch.js';
import { reportDirectoryIssue } from './logger.js';

export async function bootApp(env?: ConfigEnvironment): Promise<Application> {
	const options = env === undefined ? {} : { env };
	let path: string;
	let publicDir: string;
	let directory: Directory;
	try {
		path = resolveConfigPath(options);
		publicDir = resolvePublicDir(path, options);
		directory = await loadDirectory(path, { ...options, report: reportDirectoryIssue });
	} catch (error) {
		if (error instanceof DirectoryError) throw error;
		throw new DirectoryError({ code: 'load_failed' });
	}

	let authentication: Authentication | undefined;
	try {
		const auth = directory.currentSnapshot().configuration.auth;
		if (auth !== undefined) authentication = createAuthentication(auth, env);
	} catch (error) {
		directory.stop();
		if (error instanceof AuthSettingsError) throw error;
		throw new DirectoryError({ code: 'auth_failed' });
	}

	let stopWatching: () => void;
	try {
		stopWatching = watchConfig(path, () => directory.reload());
	} catch {
		directory.stop();
		throw new DirectoryError({ code: 'watch_failed' });
	}

	// Catch a save between the initial read and installation of the path watcher.
	await directory.reload();
	return {
		directory,
		publicDir,
		authentication,
		stop() {
			stopWatching();
			directory.stop();
		}
	};
}
