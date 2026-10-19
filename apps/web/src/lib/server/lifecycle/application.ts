import type { Authentication } from '../auth/index.js';
import type { Directory } from '../config/load-directory.js';

export interface Application {
	readonly directory: Directory;
	readonly authentication: Authentication | undefined;
	stop(): void;
}

export interface ServerState {
	application: Application | undefined;
}
