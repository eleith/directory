import { ConfigError, loadConfigFile } from '@directory/config';
import type { ConfigEnvironment } from '@directory/config/types';
import type { Server } from 'node:http';
import { DirectoryError } from './directory-error.js';

export const PUBLIC_PROTOCOL_HEADER = 'x-directory-public-protocol';
export const PUBLIC_AUTHORITY_HEADER = 'x-directory-public-authority';

export interface RuntimeEnvironment {
	readonly env: ConfigEnvironment;
	readonly origin: string;
}

// The standalone bootstrap and Kit's bundled hooks need the same captured values.
const runtimeKey = Symbol.for('directory.runtime-environment');
const runtimeState = globalThis as typeof globalThis & {
	[runtimeKey]?: RuntimeEnvironment;
};

export async function prepareRuntimeEnvironment(
	env: ConfigEnvironment = process.env
): Promise<RuntimeEnvironment> {
	const captured = Object.freeze({ ...env });
	let origin: string;
	try {
		const config = await loadConfigFile(undefined, { env: captured });
		origin = config.site.url;
	} catch (error) {
		throw new DirectoryError({
			code: 'load_failed',
			...(error instanceof ConfigError ? { issues: error.issues } : {})
		});
	}

	const runtime = Object.freeze({ env: captured, origin });
	runtimeState[runtimeKey] = runtime;
	return runtime;
}

export function getRuntimeEnvironment(): RuntimeEnvironment {
	const runtime = runtimeState[runtimeKey];
	if (!runtime) throw new DirectoryError({ code: 'prepare_failed' });
	return runtime;
}

export function prepareAdapterEnvironment(env: NodeJS.ProcessEnv = process.env): void {
	delete env.ORIGIN;
	env.PROTOCOL_HEADER = PUBLIC_PROTOCOL_HEADER;
	env.HOST_HEADER = PUBLIC_AUTHORITY_HEADER;
	env.PORT_HEADER = '';
}

export function installRequestOrigin(server: Server, origin: string): void {
	const url = new URL(origin);
	const protocol = url.protocol.slice(0, -1);
	server.prependListener('request', (request) => {
		request.headers[PUBLIC_PROTOCOL_HEADER] = protocol;
		request.headers[PUBLIC_AUTHORITY_HEADER] = url.host;
	});
}
