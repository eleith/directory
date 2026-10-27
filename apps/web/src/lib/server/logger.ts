import { ConfigError } from '@directory/config';
import { Logger } from 'tslog';
import { DirectoryError, type DirectoryIssue } from './directory-error.js';

let logType: 'pretty' | 'json' = 'pretty';
if (process.env.NODE_ENV === 'production') logType = 'json';

export const logger = new Logger({
	name: 'directory',
	type: logType,
	stack: { capture: 'off' }
});

export function reportDirectoryIssue(issue: DirectoryIssue): void {
	logger.error(`Configuration update rejected (${issue.code}).`);
	reportIssueDetails(issue);
}

export function reportConfigError(error: unknown): void {
	if (error instanceof DirectoryError) {
		reportDirectoryIssue(error.issue);
	} else {
		reportDirectoryIssue({
			code: 'load_failed',
			...(error instanceof ConfigError ? { issues: error.issues } : {})
		});
	}
}

export function reportStartupFailure(error: unknown): void {
	if (error instanceof DirectoryError) {
		logger.error(`Application startup failed (${error.issue.code}).`);
		reportIssueDetails(error.issue);
	} else {
		logger.error('Application startup failed (startup_failed).');
	}
}

function reportIssueDetails(issue: DirectoryIssue): void {
	for (const detail of issue.issues ?? []) {
		logger.error(`  ${detail.path} (${detail.code})`);
	}
}
