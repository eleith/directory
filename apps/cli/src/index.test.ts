import { ConfigError, configurationVersion, loadConfigFile } from '@directory/config';
import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const buildDirectory = new URL('../dist/', import.meta.url);
const workspaceDirectory = fileURLToPath(new URL('../../../', import.meta.url));
const sentinel = 'DO_NOT_PRINT';
let isolatedDirectory: string;
let executablePath: string;
let apiPath: string;

type Environment = Readonly<Record<string, string | undefined>>;

interface ValidationCase {
	name: string;
	yaml?: string;
	env?: Environment;
	valid: boolean;
}

const validationCases: ValidationCase[] = [
	{ name: 'minimal YAML', yaml: 'links: {}\n', valid: true },
	...[true, false].map(
		(value): ValidationCase => ({
			name: `global link target preference ${value}`,
			yaml: `site: {open_links_in_new_tab: ${value}}\nlinks: {}\n`,
			valid: true
		})
	),
	...['"true"', '"false"', '0', 'null'].map(
		(value): ValidationCase => ({
			name: `invalid global link target preference ${value}`,
			yaml: `site: {open_links_in_new_tab: ${value}}\nlinks: {}\n`,
			valid: false
		})
	),
	{
		name: 'environment-expanded link target string is not a boolean',
		yaml: "site: {open_links_in_new_tab: '${DIRECTORY_CLI_FLAG}'}\nlinks: {}\n",
		env: { DIRECTORY_CLI_FLAG: 'false' },
		valid: false
	},
	{
		name: 'per-bookmark link target preference is an unknown field',
		yaml: 'links:\n  photos: {title: DO_NOT_PRINT_TITLE, url: https://example.com, open_links_in_new_tab: false}\n',
		valid: false
	},
	{
		name: 'YAML tag list with an interpolated label and literal comma',
		yaml: "links:\n  photos: {title: DO_NOT_PRINT_TITLE, url: https://example.com, tags: ['${TAG}', 'family, photos']}\n",
		env: { TAG: 'DO_NOT_PRINT_TAG' },
		valid: true
	},
	{
		name: 'empty YAML tag list',
		yaml: 'links:\n  photos: {title: DO_NOT_PRINT_TITLE, url: https://example.com, tags: []}\n',
		valid: true
	},
	{
		name: 'legacy CSV tags are rejected',
		yaml: "links:\n  photos: {title: DO_NOT_PRINT_TITLE, url: https://example.com, tags: 'DO_NOT_PRINT_TAG,other'}\n",
		valid: false
	},
	{
		name: 'tag list with a non-string item is rejected',
		yaml: 'links:\n  photos: {title: DO_NOT_PRINT_TITLE, url: https://example.com, tags: [1]}\n',
		valid: false
	},
	{
		name: 'explicit bundled site logo and favicon',
		yaml: 'site: {logo_path: /favicon.svg, favicon_path: /favicon.svg}\nlinks: {}\n',
		valid: true
	},
	...['logo_path', 'favicon_path'].flatMap((field): ValidationCase[] => [
		{
			name: `invalid mounted site ${field}`,
			yaml: `site: {${field}: /public/../DO_NOT_PRINT.svg}\nlinks: {}\n`,
			valid: false
		},
		{
			name: `invalid bundled site ${field}`,
			yaml: `site: {${field}: /favicon.svg/DO_NOT_PRINT.svg}\nlinks: {}\n`,
			valid: false
		}
	]),
	{
		name: 'bundled path is not a bookmark logo',
		yaml: 'links:\n  photos: {title: DO_NOT_PRINT_TITLE, url: https://example.com, logo_path: /favicon.svg}\n',
		valid: false
	},
	{
		name: 'mounted bookmark primary logo',
		yaml: 'links:\n  photos: {title: DO_NOT_PRINT_TITLE, url: https://example.com, logo_path: /public/DO_NOT_PRINT.svg}\n',
		valid: true
	},
	{
		name: 'invalid mounted bookmark primary logo',
		yaml: 'links:\n  photos: {title: DO_NOT_PRINT_TITLE, url: https://example.com, logo_path: /public/../DO_NOT_PRINT.svg}\n',
		valid: false
	},
	{
		name: 'valid-looking mounted bookmark favicon is an unknown field',
		yaml: 'links:\n  photos: {title: DO_NOT_PRINT_TITLE, url: https://example.com, favicon_path: /public/DO_NOT_PRINT.png}\n',
		valid: false
	},
	{
		name: 'configured data and credentials expanded after YAML parsing',
		yaml: `site:
  title: DO_NOT_PRINT_SITE
links:
  photos:
    title: DO_NOT_PRINT_TITLE
    url: https://example.com/DO_NOT_PRINT_URL
    description: |
      DO_NOT_PRINT_DESCRIPTION
      A multiline description.
auth:
  credentials:
    username: DO_NOT_PRINT_USERNAME
    password: '\${DIRECTORY_CLI_PASSWORD}'
`,
		env: { DIRECTORY_CLI_PASSWORD: 'DO_NOT_PRINT_PASSWORD: [\n# YAML-shaped secret' },
		valid: true
	},
	{
		name: 'OIDC environment values',
		yaml: `links: {}
auth:
  oidc:
    issuer: '\${DIRECTORY_CLI_ISSUER}'
    client_id: DO_NOT_PRINT_CLIENT
    client_secret: '\${DIRECTORY_CLI_SECRET}'
`,
		env: {
			DIRECTORY_CLI_ISSUER: 'https://identity.example.com/DO_NOT_PRINT_ISSUER',
			DIRECTORY_CLI_SECRET: 'DO_NOT_PRINT_CLIENT_SECRET'
		},
		valid: true
	},
	{ name: 'unreadable file', valid: false },
	{
		name: 'YAML parser failure with a credential sentinel',
		yaml: `links: {}
auth:
  credentials:
    password: [DO_NOT_PRINT_PARSE_SECRET
`,
		valid: false
	},
	{
		name: 'unknown authored field',
		yaml: `links: {}
DO_NOT_PRINT_FIELD: DO_NOT_PRINT_VALUE
`,
		valid: false
	},
	{
		name: 'missing environment variable',
		yaml: `links: {}
site:
  title: '\${DO_NOT_PRINT_MISSING_VARIABLE}'
`,
		valid: false
	},
	{
		name: 'invalid expanded URL',
		yaml: `links:
  photos:
    title: DO_NOT_PRINT_TITLE
    url: '\${DIRECTORY_CLI_URL}'
`,
		env: { DIRECTORY_CLI_URL: 'DO_NOT_PRINT_INVALID_URL' },
		valid: false
	},
	{
		name: 'invalid authored link identifier',
		yaml: `links:
  DO_NOT_PRINT_KEY:
    title: DO_NOT_PRINT_TITLE
    url: https://example.com
`,
		valid: false
	},
	{
		name: 'invalid expanded credential',
		yaml: `links: {}
auth:
  credentials:
    username: DO_NOT_PRINT_USER
    password: '\${DIRECTORY_CLI_PASSWORD}'
`,
		env: { DIRECTORY_CLI_PASSWORD: '' },
		valid: false
	},
	{
		name: 'incomplete auth',
		yaml: `links: {}
auth:
  credentials:
    password: DO_NOT_PRINT_PASSWORD
`,
		valid: false
	},
	{
		name: 'mixed auth strategies',
		yaml: `links: {}
auth:
  credentials:
    username: DO_NOT_PRINT_USER
    password: DO_NOT_PRINT_PASSWORD
  oidc:
    issuer: https://identity.example.com
    client_id: DO_NOT_PRINT_CLIENT
    client_secret: DO_NOT_PRINT_SECRET
`,
		valid: false
	}
];

beforeAll(() => {
	isolatedDirectory = mkdtempSync(join(tmpdir(), 'directory-cli-standalone-'));
	executablePath = join(isolatedDirectory, 'index.js');
	apiPath = join(isolatedDirectory, 'cli.js');
	copyFileSync(new URL('index.js', buildDirectory), executablePath);
	copyFileSync(new URL('cli.js', buildDirectory), apiPath);
});

afterAll(() => {
	if (isolatedDirectory) rmSync(isolatedDirectory, { recursive: true, force: true });
});

function runExecutable(args: readonly string[], env: Environment = {}) {
	const result = spawnSync(process.execPath, [executablePath, ...args], {
		cwd: isolatedDirectory,
		env,
		encoding: 'utf8',
		timeout: 10_000
	});
	expect(result.error).toBeUndefined();
	expect(result.signal).toBeNull();
	return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runCallableApi(args: readonly string[], env: Environment) {
	const script = `
const { runCli } = await import(${JSON.stringify(pathToFileURL(apiPath).href)});
const result = { exitCode: null, stdout: '', stderr: '' };
try {
  result.exitCode = await runCli(${JSON.stringify(args)}, {
    stdout: text => { result.stdout += text; },
    stderr: text => { result.stderr += text; }
  }, { env: ${JSON.stringify(env)} });
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({ unexpectedException: error }));
  process.exitCode = 1;
}
`;
	const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
		cwd: isolatedDirectory,
		env: { CONFIG_PATH: 'DO_NOT_PRINT_UNEXPECTED_PROCESS_ENV' },
		encoding: 'utf8',
		timeout: 10_000
	});

	expect(result.error).toBeUndefined();
	expect(result.signal).toBeNull();
	expect(result.status).toBe(0);
	expect(result.stderr).toBe('');
	expect(result.stdout).not.toContain(sentinel);
	return JSON.parse(result.stdout) as unknown;
}

async function sharedLoaderOutcome(path: string, env: Environment) {
	try {
		await loadConfigFile(path, { env });
		return { exitCode: 0, stdout: 'Configuration is valid.\n', stderr: '' };
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		if (!(error instanceof ConfigError)) throw error;
		expect(JSON.stringify(error)).not.toContain(sentinel);
		return {
			exitCode: 1,
			stdout: '',
			stderr: `Configuration validation failed.\n${error.message}\n`
		};
	}
}

describe('standalone compiled CLI with only copied index.js and cli.js', () => {
	it('runs outside the workspace and node_modules without package metadata', () => {
		const workspaceRelativePath = relative(workspaceDirectory, isolatedDirectory);
		expect(workspaceRelativePath.startsWith(`..${sep}`)).toBe(true);
		expect(isolatedDirectory.split(sep)).not.toContain('node_modules');
		expect(readFileSync(executablePath, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');
		expect(statSync(new URL('index.js', buildDirectory)).mode & 0o111).not.toBe(0);
	});

	it.each([
		['--help'],
		['-h'],
		['-h', '-h'],
		['--', '--help'],
		['--', '-h'],
		['validate', '--help'],
		['validate', '-h'],
		['validate', '-h', '-h'],
		['validate', 'DO_NOT_PRINT_PATH', '--help'],
		['validate', '--help', 'DO_NOT_PRINT_PATH'],
		['--', 'validate', '--help'],
		['--', 'validate', '-h'],
		['--', 'validate', 'DO_NOT_PRINT_PATH', '--help']
	])('prints generated help for %j without needing a readable config', (...args) => {
		const env = { CONFIG_PATH: 'DO_NOT_PRINT_MISSING_CONFIG', SECRET: 'DO_NOT_PRINT_SECRET' };
		const result = runExecutable(args, env);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('Directory — configuration validation.');
		expect(result.stdout).toContain(
			`Supported configuration format version: ${configurationVersion}.`
		);
		expect(result.stdout).toContain('CONFIG_PATH');
		expect(result.stdout).toContain('config/directory.yaml');
		expect(result.stdout).toContain('USAGE:');
		expect(result.stdout).toMatch(/-h, --help\s+Display this help message/);
		if (args.includes('validate')) {
			expect(result.stdout).toContain('directory validate <OPTIONS> [<path>]');
			expect(result.stdout).toContain('ARGUMENTS:');
			expect(result.stdout).toMatch(/path\s+Path to the YAML configuration\./);
			expect(result.stdout).not.toContain('COMMANDS:');
		} else {
			expect(result.stdout).toContain('directory [COMMANDS] <OPTIONS>');
			expect(result.stdout).toContain('COMMANDS:');
			expect(result.stdout).toMatch(/validate <OPTIONS>\s+Validate a YAML configuration/);
			expect(result.stdout).not.toContain('ARGUMENTS:');
		}
		expect(result.stdout).not.toContain(sentinel);
		expect(runCallableApi(args, env)).toEqual(result);
	});

	it.each([
		[],
		['--'],
		['--unknown'],
		['init'],
		['DO_NOT_PRINT_ARGUMENT'],
		[''],
		['', 'validate'],
		['', 'validate', '--help'],
		['', 'validate', 'DO_NOT_PRINT_PATH'],
		['--help', 'DO_NOT_PRINT_ARGUMENT'],
		['DO_NOT_PRINT_ARGUMENT', '--help'],
		['--unknown=DO_NOT_PRINT_VALUE', '--help'],
		['--help', '--DO_NOT_PRINT_OPTION'],
		['--help=DO_NOT_PRINT_VALUE'],
		['--', '--', '--help'],
		['--', '--', 'validate'],
		['--', '--', '--', 'validate'],
		['validate', '--'],
		['validate', '--', '--'],
		['--', 'validate', '--', 'DO_NOT_PRINT_PATH'],
		['validate', '--unknown'],
		['validate', '--h'],
		['validate', '--v'],
		['validate', '--h', '--help'],
		['validate', '--unknown=DO_NOT_PRINT_VALUE', '--help'],
		['validate', '--help', '--DO_NOT_PRINT_OPTION'],
		['validate', '--help=DO_NOT_PRINT_VALUE'],
		['validate', ''],
		['validate', '', '--help'],
		['validate', 'DO_NOT_PRINT_PATH', 'extra'],
		['validate', 'DO_NOT_PRINT_PATH', 'extra', '--help']
	])('rejects invalid arguments %j without echoing them', (...args) => {
		const expected = {
			exitCode: 1,
			stdout: '',
			stderr: 'Command failed. Run directory --help for usage.\n'
		};
		const env = { CONFIG_PATH: 'DO_NOT_PRINT_ENV_PATH', SECRET: 'DO_NOT_PRINT_SECRET' };

		expect(runExecutable(args, env)).toEqual(expected);
		expect(runCallableApi(args, env)).toEqual(expected);
	});

	it.each([['--version'], ['-v'], ['validate', '--version']])(
		'preserves native unversioned output for %j without configuration',
		(...args) => {
			const env = { CONFIG_PATH: 'DO_NOT_PRINT_MISSING_CONFIG' };
			const expected = { exitCode: 0, stdout: 'unknown\n', stderr: '' };

			expect(runExecutable(args, env)).toEqual(expected);
			expect(runCallableApi(args, env)).toEqual(expected);
		}
	);

	it.each(validationCases)('matches the shared loader for $name', async (testCase) => {
		const path = join(
			isolatedDirectory,
			`DO_NOT_PRINT_PATH_${validationCases.indexOf(testCase)}.yaml`
		);
		if (testCase.yaml !== undefined) writeFileSync(path, testCase.yaml);
		const env = testCase.env ?? {};
		const expected = await sharedLoaderOutcome(path, env);

		expect(expected.exitCode).toBe(testCase.valid ? 0 : 1);
		expect(runExecutable(['validate', path], env)).toEqual(expected);
		expect(runCallableApi(['validate', path], env)).toEqual(expected);
		expect(JSON.stringify(expected)).not.toContain(sentinel);
	});

	it('rejects a directory as unreadable without exposing its path', async () => {
		const path = join(isolatedDirectory, 'DO_NOT_PRINT_DIRECTORY');
		mkdirSync(path);
		expect(runExecutable(['validate', path])).toEqual(await sharedLoaderOutcome(path, {}));
		expect(runExecutable(['validate', path]).exitCode).toBe(1);
	});

	it('uses explicit path, CONFIG_PATH, then the default relative to the subprocess working directory', () => {
		const defaultPath = join(isolatedDirectory, 'config', 'directory.yaml');
		mkdirSync(dirname(defaultPath), { recursive: true });
		writeFileSync(defaultPath, 'links: {}\n');
		const envPath = join(isolatedDirectory, 'DO_NOT_PRINT_ENV_PATH.yaml');
		writeFileSync(envPath, 'links: {}\n');
		const badPath = join(isolatedDirectory, 'DO_NOT_PRINT_INVALID_PATH.yaml');
		writeFileSync(badPath, 'links: []\n');
		const success = { exitCode: 0, stdout: 'Configuration is valid.\n', stderr: '' };

		expect(runExecutable(['validate'])).toEqual(success);
		expect(runExecutable(['--', 'validate'])).toEqual(success);
		expect(runExecutable(['validate'], { CONFIG_PATH: envPath })).toEqual(success);
		expect(runCallableApi(['validate'], { CONFIG_PATH: envPath })).toEqual(success);
		expect(runExecutable(['validate', envPath], { CONFIG_PATH: badPath })).toEqual(success);
		expect(runExecutable(['validate'], { CONFIG_PATH: badPath }).exitCode).toBe(1);
		rmSync(defaultPath);
		expect(runExecutable(['validate'], { CONFIG_PATH: envPath })).toEqual(success);
		expect(runExecutable(['validate']).exitCode).toBe(1);
	});

	it('imports the isolated callable API without executing main or printing anything', () => {
		const imported = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'--eval',
				`const { runCli } = await import(${JSON.stringify(pathToFileURL(apiPath).href)});
if (typeof runCli !== 'function') process.exitCode = 1;`
			],
			{ cwd: isolatedDirectory, env: {}, encoding: 'utf8', timeout: 10_000 }
		);

		expect(imported.error).toBeUndefined();
		expect(imported.status).toBe(0);
		expect(imported.stdout).toBe('');
		expect(imported.stderr).toBe('');
	});
});
