import { describe, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';

describe('runCli', () => {
	it.each([['--help'], ['-h'], ['--', '--help'], ['--', '-h']])(
		'shows bootstrap help for %j',
		(...args) => {
			const output = { stdout: vi.fn(), stderr: vi.fn() };

			expect(runCli(args, output)).toBe(0);
			expect(output.stderr).not.toHaveBeenCalled();
			expect(output.stdout).toHaveBeenCalledExactlyOnceWith(
				expect.stringContaining('Supported configuration format version: 1.')
			);
			expect(output.stdout).toHaveBeenCalledWith(
				expect.stringContaining('validator is not available in this bootstrap')
			);
		}
	);

	it.each([
		[],
		['--'],
		['--unknown'],
		['validate'],
		['validate', 'where.yaml'],
		['--', 'validate', 'where.yaml'],
		['--help', 'extra'],
		['extra', '--help'],
		['--', '--', '--help']
	])('rejects unsupported or missing arguments %j', (...args) => {
		const output = { stdout: vi.fn(), stderr: vi.fn() };
		const original = [...args];

		expect(runCli(args, output)).toBe(1);
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining('Run where --help')
		);
		expect(args).toEqual(original);
	});
});
