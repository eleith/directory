import {
	ConfigError,
	loadConfigFile,
	resolveConfigPath,
	resolvePublicDir,
	startConfigReloading
} from '@directory/config';
import type { ConfigEnvironment, DirectoryConfiguration } from '@directory/config/types';
import { createApplication, type Application } from './application.js';
import { DirectoryError } from './directory-error.js';
import { reportConfigError } from './logger.js';

export async function bootApp(
	env: ConfigEnvironment = process.env,
	frameworkEnv: ConfigEnvironment = process.env
): Promise<Application> {
	const options = { env };
	let path: string;
	let publicDir: string;
	let config: DirectoryConfiguration;
	try {
		path = resolveConfigPath(options);
		publicDir = resolvePublicDir(path, options);
		config = await loadConfigFile(path, options);
	} catch (error) {
		throw new DirectoryError({
			code: 'load_failed',
			...(error instanceof ConfigError ? { issues: error.issues } : {})
		});
	}

	// Reject changes between framework URL preparation and the initial application load.
	if (
		config.auth?.origin !== (process.env.ORIGIN || undefined) ||
		config.auth?.origin !== (frameworkEnv.ORIGIN || undefined) ||
		config.auth?.origin !== (frameworkEnv.AUTH_URL || undefined)
	) {
		throw new DirectoryError({ code: 'auth_failed' });
	}

	const application = createApplication(config);
	let stop: () => void;
	try {
		stop = await startConfigReloading({
			path,
			initial: config,
			load: (path) => loadConfigFile(path, options),
			onChange: application.onConfigChange,
			onError: reportConfigError
		});
	} catch {
		throw new DirectoryError({ code: 'watch_failed' });
	}
	return { ...application, publicDir, stop };
}
