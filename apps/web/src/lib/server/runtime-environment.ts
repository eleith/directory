import { ConfigError, loadConfigFile } from '@directory/config';
import { DirectoryError } from './directory-error.js';

export async function prepareRuntimeEnvironment(
	env: NodeJS.ProcessEnv = process.env
): Promise<void> {
	let origin: string | undefined;
	try {
		origin = (await loadConfigFile(undefined, { env })).auth?.origin;
	} catch (error) {
		throw new DirectoryError({
			code: 'load_failed',
			...(error instanceof ConfigError ? { issues: error.issues } : {})
		});
	}

	if (origin === undefined) {
		delete env.ORIGIN;
		delete env.AUTH_URL;
	} else {
		env.ORIGIN = origin;
		env.AUTH_URL = origin;
	}
	env.NEXTAUTH_URL = '';
	env.AUTH_REDIRECT_PROXY_URL = '';
}
