import type { ConfigEnvironment } from '@directory/config/types';
import { bootApp } from '../boot.js';
import type { Application, ServerState } from '../application.js';

export async function startProduction(server: ServerState, env?: ConfigEnvironment): Promise<void> {
	const application = await bootApp(undefined, env);
	// adapter-node emits shutdown after listening, which waits for Kit init.
	process.once('sveltekit:shutdown', () => stopProduction(server, application));
	server.application = application;
}

function stopProduction(server: ServerState, application: Application): void {
	application.stop();
	if (server.application === application) server.application = undefined;
}
