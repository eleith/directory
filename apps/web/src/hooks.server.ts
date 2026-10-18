import { building, dev } from '$app/environment';
import type { Handle, ServerInit } from '@sveltejs/kit';
import type { ServerState } from './lib/server/lifecycle/application.js';
import { startDevelopment } from './lib/server/lifecycle/development.js';
import { startProduction } from './lib/server/lifecycle/production.js';
import { reportStartupFailure } from './lib/server/logger.js';

const server: ServerState = { directory: undefined };

export const init: ServerInit = async () => {
	if (building) return;
	try {
		if (dev) await startDevelopment(server);
		else await startProduction(server);
	} catch (error) {
		reportStartupFailure(error);
		// eslint-disable-next-line preserve-caught-error -- Raw startup errors may contain configuration secrets.
		throw new Error('Application startup failed.');
	}
};

export const handle: Handle = ({ event, resolve }) => {
	if (server.directory === undefined) {
		return new Response('Service unavailable', { status: 503 });
	}
	event.locals.snapshot = server.directory.currentSnapshot();
	return resolve(event);
};
