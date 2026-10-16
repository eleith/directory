import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const entry = new URL('../dist/index.js', import.meta.url);
let cwd: string;

beforeAll(() => {
	cwd = mkdtempSync(join(tmpdir(), 'where-cli-'));
});

afterAll(() => {
	rmSync(cwd, { recursive: true, force: true });
});

function run(args: string[]) {
	return spawnSync(process.execPath, [fileURLToPath(entry), ...args], {
		cwd,
		encoding: 'utf8',
		timeout: 10_000
	});
}

describe('compiled CLI from an unrelated working directory', () => {
	it('preserves the Node shebang in the executable artifact', () => {
		expect(readFileSync(entry, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');
	});

	it.each([['--help'], ['-h'], ['--', '--help']])(
		'loads compiled workspace dependencies and prints help for %j',
		(...args) => {
			const result = run(args);

			expect(result.error).toBeUndefined();
			expect(result.signal).toBeNull();
			expect(result.status).toBe(0);
			expect(result.stderr).toBe('');
			expect(result.stdout).toContain('Supported configuration format version: 1.');
			expect(result.stdout).toContain('validator is not available');
		}
	);

	it.each([[], ['--unknown'], ['--', 'validate', 'where.yaml']])(
		'exits unsuccessfully rather than pretending to validate %j',
		(...args) => {
			const result = run(args);

			expect(result.error).toBeUndefined();
			expect(result.signal).toBeNull();
			expect(result.status).toBe(1);
			expect(result.stdout).toBe('');
			expect(result.stderr).toContain('Run where --help');
		}
	);

	it('allows importing the callable API without executing main', () => {
		const api = new URL('../dist/cli.js', import.meta.url);
		const imported = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'--eval',
				`const { runCli } = await import(${JSON.stringify(api.href)});
if (typeof runCli !== 'function') process.exitCode = 1;`
			],
			{ cwd, encoding: 'utf8', timeout: 10_000 }
		);

		expect(imported.error).toBeUndefined();
		expect(imported.status).toBe(0);
		expect(imported.stdout).toBe('');
		expect(imported.stderr).toBe('');
	});
});
