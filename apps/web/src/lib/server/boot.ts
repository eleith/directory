import { resolveConfigPath, resolvePublicDir } from '@directory/config';
import type { ConfigEnvironment } from '@directory/config/types';
import { createAuthentication, type Authentication } from './auth/index.js';
import { loadDirectory, type Directory } from './config/load-directory.js';
import { DirectoryError } from './directory-error.js';
import type { Application } from './lifecycle/application.js';
import { watchConfig } from './config/watch.js';
import { reportDirectoryIssue } from './logger.js';

export async function bootApp(
	env: ConfigEnvironment = process.env,
	frameworkEnv: ConfigEnvironment = process.env
): Promise<Application> {
	const options = { env };
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
		// Reject edits between URL preparation and Kit startup, including enabling/disabling auth.
		if (
			auth?.origin !== (process.env.ORIGIN || undefined) ||
			auth?.origin !== (frameworkEnv.ORIGIN || undefined) ||
			auth?.origin !== (frameworkEnv.AUTH_URL || undefined)
		) {
			throw new DirectoryError({ code: 'auth_failed' });
		}
		if (auth !== undefined) authentication = createAuthentication(auth);
	} catch {
		directory.stop();
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
