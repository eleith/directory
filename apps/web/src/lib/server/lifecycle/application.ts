import type { Directory } from '../config/load-directory.js';

export interface ServerState {
	directory: Directory | undefined;
}
