import { bootApp } from '../boot.js';
import type { Directory } from '../config/load-directory.js';
import type { ServerState } from './application.js';

interface DevelopmentAttempt {
	readonly server: ServerState;
	directory: Directory | undefined;
	stopped: boolean;
}

export async function startDevelopment(server: ServerState): Promise<void> {
	// The process event reaches both cached hooks and replaced server modules.
	process.emit('where:dev-stop');
	const attempt: DevelopmentAttempt = { server, directory: undefined, stopped: false };
	const shutdown = () => stopDevelopment(attempt, shutdown);
	process.once('where:dev-stop', shutdown);
	let directory: Directory;
	try {
		directory = await bootApp();
	} catch (error) {
		stopDevelopment(attempt, shutdown);
		throw error;
	}
	if (attempt.stopped) {
		directory.stop();
		return;
	}
	attempt.directory = directory;
	server.directory = directory;
}

function stopDevelopment(attempt: DevelopmentAttempt, shutdown: () => void): void {
	if (attempt.stopped) return;
	attempt.stopped = true;
	process.off('where:dev-stop', shutdown);
	attempt.directory?.stop();
	if (attempt.server.directory === attempt.directory) attempt.server.directory = undefined;
}
