import { building, dev } from '$app/environment';
import type { Handle, ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { themeStyleTag } from './lib/server/appearance.js';
import type { ServerState } from './lib/server/lifecycle/application.js';
import { startDevelopment } from './lib/server/lifecycle/development.js';
import { startProduction } from './lib/server/lifecycle/production.js';
import { reportStartupFailure } from './lib/server/logger.js';

const server: ServerState = { application: undefined };

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

const applicationHandle: Handle = ({ event, resolve }) => {
	const application = server.application;
	if (application === undefined) {
		return new Response('Service unavailable', {
			status: 503,
			headers: { 'cache-control': 'no-store' }
		});
	}
	event.locals.snapshot = application.directory.currentSnapshot();
	event.locals.publicDir = application.publicDir;
	event.locals.authentication = application.authentication;
	event.locals.session = null;
	if (application.authentication === undefined) {
		event.locals.auth = async () => null;
		return resolve(event);
	}
	return application.authentication.handle({ event, resolve });
};

const themeHandle: Handle = ({ event, resolve }) => {
	const style = themeStyleTag(event.locals.snapshot.display.appearance);
	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('</head>', `\t${style}\n</head>`)
	});
};

export const handle = sequence(applicationHandle, themeHandle);
