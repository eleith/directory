const issueMessages = {
	file_unreadable: 'Unable to read the configuration file.',
	invalid_yaml: 'Invalid YAML document.',
	invalid_shape: 'Expected plain configuration data.',
	missing_environment: 'An environment variable is not set.',
	invalid_value: 'Value does not match the configuration rules.'
} as const;

export type ConfigIssueCode = keyof typeof issueMessages;
export interface ConfigIssue {
	readonly code: ConfigIssueCode;
	readonly path: string;
	readonly message: string;
}

type IssueLocation = Pick<ConfigIssue, 'code' | 'path'>;

const fieldNames = new Set([
	'version',
	'site',
	'appearance',
	'auth',
	'links',
	'title',
	'description',
	'logo_path',
	'favicon_path',
	'footer',
	'primary_light_color',
	'primary_dark_color',
	'oidc',
	'credentials',
	'issuer',
	'client_id',
	'client_secret',
	'username',
	'password',
	'url',
	'tags',
	'group',
	'requires_auth',
	'internal_only',
	'admin_only'
]);

export class ConfigError extends Error {
	readonly issues: readonly ConfigIssue[];

	constructor(locations: readonly IssueLocation[]) {
		const issues = locations.map(createSafeIssue);
		super(
			`Configuration is invalid.\n${issues.map((issue) => `  ${issue.path}: ${issue.message} (${issue.code})`).join('\n')}`
		);
		this.name = 'ConfigError';
		this.issues = Object.freeze(issues);
	}
}

function createSafeIssue(location: IssueLocation): ConfigIssue {
	let code = location.code;
	if (!Object.hasOwn(issueMessages, code)) code = 'invalid_value';
	return Object.freeze({
		code,
		path: safeIssuePath(location.path),
		message: issueMessages[code]
	});
}

function safeIssuePath(path: string): string {
	if (path === '' || path === '/') return '/';
	const parts = path.split('/').slice(1);
	const safeParts: string[] = [];
	for (const [index, part] of parts.entries()) {
		const isLinkIdentifier = index === 1 && parts[0] === 'links';
		if (isLinkIdentifier) {
			safeParts.push('*');
			continue;
		}
		if (fieldNames.has(part)) safeParts.push(part);
		else safeParts.push('*');
	}
	return safeParts.length === 0 ? '/' : `/${safeParts.join('/')}`;
}
