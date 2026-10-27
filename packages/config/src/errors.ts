import { TypeGuard, type TSchema } from '@sinclair/typebox';
import { configurationReferences, DirectoryConfigurationSchema } from './schema.js';

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

type IssueLocation = Pick<ConfigIssue, 'code' | 'path'> & {
	reason?: 'explicit_site_url_required';
};

const schemaFieldNames = new Set(
	[DirectoryConfigurationSchema, ...configurationReferences].flatMap(getSchemaFieldNames)
);

export class ConfigError extends Error {
	readonly issues: readonly ConfigIssue[];

	constructor(locations: readonly IssueLocation[]) {
		const issues = locations.map(redactIssue);
		const details = issues
			.map((issue) => `  ${issue.path}: ${issue.message} (${issue.code})`)
			.join('\n');
		super(`Configuration is invalid.\n${details}`);
		this.name = 'ConfigError';
		this.issues = Object.freeze(issues);
	}
}

function getSchemaFieldNames(schema: TSchema): string[] {
	if (TypeGuard.IsObject(schema)) {
		const directNames = Object.keys(schema.properties);
		const nestedNames = Object.values(schema.properties).flatMap(getSchemaFieldNames);
		return [...directNames, ...nestedNames];
	}
	if (TypeGuard.IsUnion(schema)) {
		return schema.anyOf.flatMap(getSchemaFieldNames);
	}
	return [];
}

function redactIssue(location: IssueLocation): ConfigIssue {
	let code = location.code;
	if (!Object.hasOwn(issueMessages, code)) code = 'invalid_value';
	let message: string = issueMessages[code];
	if (code === 'invalid_value' && location.reason === 'explicit_site_url_required') {
		message = 'Set site.url explicitly when using a random port, socket or socket activation.';
	}
	return Object.freeze({ code, path: redactIssuePath(location.path), message });
}

function redactIssuePath(path: string): string {
	if (path === '' || path === '/') return '/';
	const segments = path.split('/').slice(1);
	const redactedSegments: string[] = [];
	for (const [index, segment] of segments.entries()) {
		const isLinkIdentifier = index === 1 && segments[0] === 'links';
		if (isLinkIdentifier || !schemaFieldNames.has(segment)) {
			redactedSegments.push('*');
			continue;
		}
		redactedSegments.push(segment);
	}
	return `/${redactedSegments.join('/')}`;
}
