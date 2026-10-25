import type { ConfigIssue } from '@directory/config';

export interface DirectoryIssue {
	readonly code:
		| 'load_failed'
		| 'prepare_failed'
		| 'restart_required'
		| 'auth_failed'
		| 'watch_failed';
	readonly issues?: readonly ConfigIssue[];
}

export class DirectoryError extends Error {
	readonly issue: DirectoryIssue;

	constructor(issue: DirectoryIssue) {
		super(`Directory startup failed (${issue.code}).`);
		this.name = 'DirectoryError';
		this.issue = Object.freeze({ ...issue });
	}
}
