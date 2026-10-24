import { ConfigError, configurationVersion, loadConfigFile } from '@directory/config';
import type { DirectoryConfiguration } from '@directory/config';
import { setImmediate } from 'node:timers/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';

vi.mock('@directory/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@directory/config')>()),
	loadConfigFile: vi.fn()
}));

const configuration: DirectoryConfiguration = {
	version: 1,
	site: {
		title: 'DO_NOT_PRINT_SITE',
		description: '',
		footer: '',
		logo_path: '/favicon.svg',
		favicon_path: '/favicon.svg',
		open_links_in_new_tab: true
	},
	appearance: { primary_light_color: '#0f766e', primary_dark_color: '#5eead4' },
	links: {}
};

function createOutput() {
	return { stdout: vi.fn(), stderr: vi.fn() };
}

beforeEach(() => {
	vi.mocked(loadConfigFile).mockReset();
	vi.mocked(loadConfigFile).mockResolvedValue(configuration);
});

describe('runCli', () => {
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
	])('shows generated help without loading configuration for %j', async (...args) => {
		const output = createOutput();
		const original = [...args];
		const env = Object.freeze({
			CONFIG_PATH: 'DO_NOT_PRINT_ENV_PATH',
			SECRET: 'DO_NOT_PRINT_SECRET'
		});

		expect(await runCli(Object.freeze(args), output, { env })).toBe(0);
		expect(loadConfigFile).not.toHaveBeenCalled();
		expect(output.stderr).not.toHaveBeenCalled();
		expect(output.stdout).toHaveBeenCalledExactlyOnceWith(expect.any(String));
		const help = output.stdout.mock.calls[0]?.[0] as string;
		expect(help).toContain('Directory — configuration validation.');
		expect(help).toContain(`Supported configuration format version: ${configurationVersion}.`);
		expect(help).toContain('CONFIG_PATH');
		expect(help).toContain('config/directory.yaml');
		expect(help).toContain('USAGE:');
		expect(help).toContain('OPTIONS:');
		expect(help).toMatch(/-h, --help\s+Display this help message/);
		if (args.includes('validate')) {
			expect(help).toContain('directory validate <OPTIONS> [<path>]');
			expect(help).toContain('ARGUMENTS:');
			expect(help).toMatch(/path\s+Path to the YAML configuration\./);
			expect(help).not.toContain('COMMANDS:');
		} else {
			expect(help).toContain('directory [COMMANDS] <OPTIONS>');
			expect(help).toContain('COMMANDS:');
			expect(help).toMatch(/validate <OPTIONS>\s+Validate a YAML configuration/);
			expect(help).not.toContain('ARGUMENTS:');
		}
		expect(help).not.toContain('DO_NOT_PRINT');
		expect(args).toEqual(original);
		expect(env).toEqual({ CONFIG_PATH: 'DO_NOT_PRINT_ENV_PATH', SECRET: 'DO_NOT_PRINT_SECRET' });
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
	])('rejects unsupported or missing arguments without echoing %j', async (...args) => {
		const output = createOutput();
		const original = [...args];

		expect(await runCli(Object.freeze(args), output)).toBe(1);
		expect(loadConfigFile).not.toHaveBeenCalled();
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith(
			'Command failed. Run directory --help for usage.\n'
		);
		expect(args).toEqual(original);
	});

	it.each([['--version'], ['-v'], ['validate', '--version']])(
		'leaves native unversioned output unchanged for %j',
		async (...args) => {
			const output = createOutput();

			expect(await runCli(args, output, { env: { CONFIG_PATH: 'DO_NOT_PRINT_ENV_PATH' } })).toBe(0);
			expect(loadConfigFile).not.toHaveBeenCalled();
			expect(output.stdout).toHaveBeenCalledExactlyOnceWith('unknown\n');
			expect(output.stderr).not.toHaveBeenCalled();
		}
	);

	it.each([
		['validate'],
		['--', 'validate'],
		['validate', 'DO_NOT_PRINT_PATH'],
		['--', 'validate', 'DO_NOT_PRINT_PATH']
	])('awaits shared validation and prints only a static success for %j', async (...args) => {
		const output = createOutput();
		const env = Object.freeze({
			CONFIG_PATH: 'DO_NOT_PRINT_ENV_PATH',
			SECRET: 'DO_NOT_PRINT_SECRET'
		});
		const original = [...args];
		const path = args[0] === '--' ? args[2] : args[1];

		expect(await runCli(Object.freeze(args), output, { env })).toBe(0);
		expect(loadConfigFile).toHaveBeenCalledExactlyOnceWith(path, { env });
		expect(output.stdout).toHaveBeenCalledExactlyOnceWith('Configuration is valid.\n');
		expect(output.stderr).not.toHaveBeenCalled();
		expect(args).toEqual(original);
	});

	it('does not report success before asynchronous validation finishes', async () => {
		const output = createOutput();
		const started = Promise.withResolvers<void>();
		const pending = Promise.withResolvers<DirectoryConfiguration>();
		vi.mocked(loadConfigFile).mockImplementation(() => {
			started.resolve();
			return pending.promise;
		});
		let settled = false;

		const result = runCli(['validate'], output, { env: {} }).then((code) => {
			settled = true;
			return code;
		});
		await started.promise;
		await setImmediate();
		expect(settled).toBe(false);
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).not.toHaveBeenCalled();
		pending.resolve(configuration);

		expect(await result).toBe(0);
		expect(output.stdout).toHaveBeenCalledExactlyOnceWith('Configuration is valid.\n');
	});

	it('isolates concurrent command environments and output sinks', async () => {
		const firstOutput = createOutput();
		const secondOutput = createOutput();
		const helpOutput = createOutput();
		const firstEnv = Object.freeze({ SECRET: 'DO_NOT_PRINT_FIRST_SECRET' });
		const secondEnv = Object.freeze({ SECRET: 'DO_NOT_PRINT_SECOND_SECRET' });
		const first = Promise.withResolvers<DirectoryConfiguration>();
		const second = Promise.withResolvers<DirectoryConfiguration>();
		const started = Promise.withResolvers<void>();
		vi.mocked(loadConfigFile).mockImplementation((path) => {
			if (vi.mocked(loadConfigFile).mock.calls.length === 2) started.resolve();
			return path === 'DO_NOT_PRINT_FIRST_PATH' ? first.promise : second.promise;
		});
		const error = new ConfigError([{ code: 'invalid_value', path: '/site/title' }]);

		const firstResult = runCli(['validate', 'DO_NOT_PRINT_FIRST_PATH'], firstOutput, {
			env: firstEnv
		});
		const secondResult = runCli(['validate', 'DO_NOT_PRINT_SECOND_PATH'], secondOutput, {
			env: secondEnv
		});
		await started.promise;
		expect(await runCli(['validate', 'DO_NOT_PRINT_HELP_PATH', '--help'], helpOutput)).toBe(0);
		expect(loadConfigFile).toHaveBeenCalledTimes(2);
		expect(loadConfigFile).toHaveBeenCalledWith('DO_NOT_PRINT_FIRST_PATH', { env: firstEnv });
		expect(loadConfigFile).toHaveBeenCalledWith('DO_NOT_PRINT_SECOND_PATH', { env: secondEnv });

		second.reject(error);
		expect(await secondResult).toBe(1);
		expect(secondOutput.stderr).toHaveBeenCalledExactlyOnceWith(
			`Configuration validation failed.\n${error.message}\n`
		);
		expect(secondOutput.stdout).not.toHaveBeenCalled();
		expect(firstOutput.stdout).not.toHaveBeenCalled();
		expect(firstOutput.stderr).not.toHaveBeenCalled();
		first.resolve(configuration);
		expect(await firstResult).toBe(0);
		expect(firstOutput.stdout).toHaveBeenCalledExactlyOnceWith('Configuration is valid.\n');
		expect(firstOutput.stderr).not.toHaveBeenCalled();
		expect(helpOutput.stderr).not.toHaveBeenCalled();
		expect(helpOutput.stdout).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('USAGE:'));
		expect(helpOutput.stdout.mock.calls[0]?.[0]).not.toContain('DO_NOT_PRINT');
	});

	it('leaves default environment and path selection to the shared loader', async () => {
		const output = createOutput();

		expect(await runCli(['validate'], output)).toBe(0);
		expect(loadConfigFile).toHaveBeenCalledExactlyOnceWith(undefined, undefined);
	});

	it('prints only the safe ConfigError message, never serialized issues or raw input', async () => {
		const output = createOutput();
		const error = new ConfigError([{ code: 'invalid_value', path: '/links/DO_NOT_PRINT_KEY/url' }]);
		vi.mocked(loadConfigFile).mockRejectedValue(error);

		expect(await runCli(['validate', 'DO_NOT_PRINT_PATH'], output, { env: {} })).toBe(1);
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith(
			`Configuration validation failed.\n${error.message}\n`
		);
		expect(output.stderr.mock.calls[0]?.[0]).not.toContain('DO_NOT_PRINT');
	});

	it.each([
		new Error('DO_NOT_PRINT_RAW_EXCEPTION'),
		'DO_NOT_PRINT_THROWN_STRING',
		{ message: 'DO_NOT_PRINT_MESSAGE', issues: ['DO_NOT_PRINT_ISSUES'] },
		null
	])('sanitizes unexpected loader failures %#', async (error) => {
		const output = createOutput();
		vi.mocked(loadConfigFile).mockRejectedValue(error);

		expect(await runCli(['validate', 'DO_NOT_PRINT_PATH'], output)).toBe(1);
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith(
			'Command failed. Run directory --help for usage.\n'
		);
	});
});
