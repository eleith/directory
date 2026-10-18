import { resolveConfigPath } from '@directory/config';
import type { ConfigEnvironment } from '@directory/config/types';
import { DirectoryError, loadDirectory, type Directory } from './config/load-directory.js';
import { watchConfig } from './config/watch.js';
import { reportDirectoryIssue } from './logger.js';

export async function bootApp(env?: ConfigEnvironment): Promise<Directory> {
	const options = env === undefined ? {} : { env };
	let path: string;
	let directory: Directory;
	try {
		path = resolveConfigPath(options);
		directory = await loadDirectory(path, { ...options, report: reportDirectoryIssue });
	} catch (error) {
		if (error instanceof DirectoryError) throw error;
		throw new DirectoryError({ code: 'load_failed' });
	}

	// C5 must not expose an authenticated configuration before providers exist.
	if (directory.currentSnapshot().configuration.auth !== undefined) {
		directory.stop();
		throw new DirectoryError({ code: 'auth_unavailable' });
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
		currentSnapshot: () => directory.currentSnapshot(),
		reload: () => directory.reload(),
		stop() {
			stopWatching();
			directory.stop();
		}
	};
}
