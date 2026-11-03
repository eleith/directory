import { bootApp } from '../boot.js';
import type { Application, ServerState } from '../application.js';

export async function startProduction(server: ServerState): Promise<void> {
	const application = await bootApp();
	// adapter-node emits shutdown after listening, which waits for Kit init.
	process.once('sveltekit:shutdown', () => stopProduction(server, application));
	server.application = application;
}

function stopProduction(server: ServerState, application: Application): void {
	application.stop();
	if (server.application === application) server.application = undefined;
}
