import { ConfigError, loadConfigFile } from '@directory/config';
import { DirectoryError } from './directory-error.js';

export async function prepareRuntimeEnvironment(
	env: NodeJS.ProcessEnv = process.env
): Promise<void> {
	let origin: string;
	try {
		const config = await loadConfigFile(undefined, { env });
		origin = config.site.url;
	} catch (error) {
		throw new DirectoryError({
			code: 'load_failed',
			...(error instanceof ConfigError ? { issues: error.issues } : {})
		});
	}

	// adapter-node 5 still captures ORIGIN before Kit starts; authentication uses site.url directly.
	env.ORIGIN = origin;
}
