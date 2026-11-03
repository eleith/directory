import { ConfigError, loadConfigFile, validateConfig } from '@directory/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';
import packageJson from '../package.json' with { type: 'json' };

vi.mock('@directory/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@directory/config')>()),
	loadConfigFile: vi.fn()
}));

function createOutput() {
	return { stdout: vi.fn(), stderr: vi.fn() };
}

beforeEach(() => {
	vi.mocked(loadConfigFile).mockReset();
	vi.mocked(loadConfigFile).mockResolvedValue(validateConfig({ links: {} }));
});

describe('directory-cli', () => {
	it('reports the release version without loading configuration', async () => {
		const output = createOutput();

		expect(await runCli(['--version'], output)).toBe(0);
		expect(output.stdout).toHaveBeenCalledExactlyOnceWith(`${packageJson.version}\n`);
		expect(output.stderr).not.toHaveBeenCalled();
		expect(loadConfigFile).not.toHaveBeenCalled();
	});

	it.each([['--help'], ['config', 'validate', '--help']])(
		'shows help without loading configuration: %j',
		async (...args) => {
			const output = createOutput();

			expect(await runCli(args, output)).toBe(0);
			expect(loadConfigFile).not.toHaveBeenCalled();
			expect(output.stderr).not.toHaveBeenCalled();
			expect(output.stdout).toHaveBeenCalledWith(expect.stringContaining('directory-cli'));
		}
	);

	it('validates an explicit path, accepting the package-manager separator', async () => {
		const output = createOutput();
		const path = '/config/directory.yaml';

		expect(await runCli(['--', 'config', 'validate', path], output)).toBe(0);
		expect(loadConfigFile).toHaveBeenCalledExactlyOnceWith(path);
		expect(output.stdout).toHaveBeenCalledExactlyOnceWith('Configuration is valid.\n');
		expect(output.stderr).not.toHaveBeenCalled();
	});

	it('leaves the configured or default path to the shared loader when omitted', async () => {
		const output = createOutput();

		expect(await runCli(['config', 'validate'], output)).toBe(0);
		expect(loadConfigFile).toHaveBeenCalledExactlyOnceWith(undefined);
		expect(output.stdout).toHaveBeenCalledExactlyOnceWith('Configuration is valid.\n');
		expect(output.stderr).not.toHaveBeenCalled();
	});

	it('rejects an unknown option rather than silently ignoring it', async () => {
		const output = createOutput();

		expect(await runCli(['config', 'validate', '--DO_NOT_PRINT_OPTION'], output)).toBe(1);
		expect(loadConfigFile).not.toHaveBeenCalled();
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith(
			'Command failed. Run directory-cli --help for usage.\n'
		);
	});

	it('reports configuration failures without exposing authored values', async () => {
		const output = createOutput();
		const error = new ConfigError([{ code: 'invalid_value', path: '/links/DO_NOT_PRINT/url' }]);
		vi.mocked(loadConfigFile).mockRejectedValue(error);

		expect(await runCli(['config', 'validate'], output)).toBe(1);
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith(
			`Configuration validation failed.\n${error.message}\n`
		);
		expect(output.stderr.mock.calls[0]?.[0]).not.toContain('DO_NOT_PRINT');
	});

	it('does not expose unexpected exception details', async () => {
		const output = createOutput();
		vi.mocked(loadConfigFile).mockRejectedValue(new Error('DO_NOT_PRINT_SECRET'));

		expect(await runCli(['config', 'validate'], output)).toBe(1);
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith(
			'Command failed. Run directory-cli --help for usage.\n'
		);
	});
});
