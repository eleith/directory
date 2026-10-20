import { Logger } from 'tslog';
import { AuthSettingsError, type AuthSetting } from './auth/settings.js';
import { DirectoryError, type DirectoryIssue } from './config/load-directory.js';

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

export function reportStartupFailure(error: unknown): void {
	if (error instanceof AuthSettingsError) {
		logger.error('Application startup failed (auth_failed).');
		const hint = authSettingsHint(error.setting);
		if (hint !== undefined) logger.error(hint);
	} else if (error instanceof DirectoryError) {
		logger.error(`Application startup failed (${error.issue.code}).`);
		reportIssueDetails(error.issue);
	} else {
		logger.error('Application startup failed (startup_failed).');
	}
}

function authSettingsHint(setting: AuthSetting): string | undefined {
	switch (setting) {
		case 'AUTH_SECRET':
			return 'Invalid authentication configuration: AUTH_SECRET is required when authentication is enabled and must contain at least 32 characters.';
		case 'ORIGIN':
			return 'Invalid authentication configuration: ORIGIN must be a canonical HTTPS root origin or HTTP localhost origin, with no trailing slash, path, query or fragment.';
		case 'AUTH_URL':
			return 'Invalid authentication configuration: AUTH_URL must be a canonical root origin matching ORIGIN exactly.';
		case 'NEXTAUTH_URL':
			return 'Invalid authentication configuration: NEXTAUTH_URL must match ORIGIN exactly or be unset.';
		case 'AUTH_REDIRECT_PROXY_URL':
			return 'Invalid authentication configuration: AUTH_REDIRECT_PROXY_URL is unsupported and must be unset.';
	}
}

function reportIssueDetails(issue: DirectoryIssue): void {
	for (const detail of issue.issues ?? []) {
		logger.error(`  ${detail.path} (${detail.code})`);
	}
}
