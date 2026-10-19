import { bootApp } from '../boot.js';
import type { Application, ServerState } from './application.js';

interface DevelopmentAttempt {
	readonly server: ServerState;
	application: Application | undefined;
	stopped: boolean;
}

export async function startDevelopment(server: ServerState): Promise<void> {
	// The process event reaches both cached hooks and replaced server modules.
	process.emit('directory:dev-stop');
	const attempt: DevelopmentAttempt = { server, application: undefined, stopped: false };
	const shutdown = () => stopDevelopment(attempt, shutdown);
	process.once('directory:dev-stop', shutdown);
	let application: Application;
	try {
		application = await bootApp();
	} catch (error) {
		stopDevelopment(attempt, shutdown);
		throw error;
	}
	if (attempt.stopped) {
		application.stop();
		return;
	}
	attempt.application = application;
	server.application = application;
}

function stopDevelopment(attempt: DevelopmentAttempt, shutdown: () => void): void {
	if (attempt.stopped) return;
	attempt.stopped = true;
	process.off('directory:dev-stop', shutdown);
	attempt.application?.stop();
	if (attempt.server.application === attempt.application) attempt.server.application = undefined;
}
