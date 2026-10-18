import { bootApp } from '../boot.js';
import type { Directory } from '../config/load-directory.js';
import type { ServerState } from './application.js';

export async function startProduction(server: ServerState): Promise<void> {
	const directory = await bootApp();
	// adapter-node emits shutdown after listening, which waits for Kit init.
	process.once('sveltekit:shutdown', () => stopProduction(server, directory));
	server.directory = directory;
}

function stopProduction(server: ServerState, directory: Directory): void {
	directory.stop();
	if (server.directory === directory) server.directory = undefined;
}
