import {
	ConfigError,
	loadConfigFile,
	resolveConfigPath,
	resolvePublicDir,
	startConfigReloading
} from '@directory/config';
import type { DirectoryConfiguration } from '@directory/config/types';
import { createApplication, type Application } from './application.js';
import { DirectoryError } from './directory-error.js';
import { reportConfigError } from './logger.js';
import { getRuntimeEnvironment, type RuntimeEnvironment } from './runtime-environment.js';

export async function bootApp(
	runtime: RuntimeEnvironment = getRuntimeEnvironment()
): Promise<Application> {
	const options = { env: runtime.env };
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
	if (config.site.url !== runtime.origin) {
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
