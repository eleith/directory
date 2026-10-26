import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DirectoryError } from './directory-error.js';
import { prepareRuntimeEnvironment } from './runtime-environment.js';

const origin = 'https://directory.example.com';
const sentinel = 'PRIVATE-runtime-setting';
let directory: string;
let path: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'directory-runtime-'));
	path = join(directory, 'directory.yaml');
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

function credentials(extra = ''): string {
	return `links: {}
auth:
  origin: '${origin}'
  credentials:
    username: family
    password: test-password
${extra}`;
}

describe('framework environment preparation', () => {
	it('uses the YAML origin instead of legacy framework settings', async () => {
		await writeFile(path, credentials());
		const env = {
			CONFIG_PATH: path,
			ORIGIN: sentinel,
			AUTH_URL: sentinel,
			NEXTAUTH_URL: sentinel,
			AUTH_REDIRECT_PROXY_URL: sentinel,
			AUTH_SECRET: sentinel
		};
		await prepareRuntimeEnvironment(env);
		expect(env.ORIGIN).toBe(origin);
		expect(env.AUTH_URL).toBe(origin);
		expect(env.NEXTAUTH_URL).toBe('');
		expect(env.AUTH_REDIRECT_PROXY_URL).toBe('');
		expect(env.AUTH_SECRET).toBe(sentinel);
	});

	it('removes inherited framework URLs for an open directory', async () => {
		await writeFile(path, 'links: {}');
		const env = {
			CONFIG_PATH: path,
			ORIGIN: sentinel,
			AUTH_URL: sentinel,
			NEXTAUTH_URL: sentinel,
			AUTH_REDIRECT_PROXY_URL: sentinel
		};
		await prepareRuntimeEnvironment(env);
		expect(env).not.toHaveProperty('ORIGIN');
		expect(env).not.toHaveProperty('AUTH_URL');
		expect(env.NEXTAUTH_URL).toBe('');
		expect(env.AUTH_REDIRECT_PROXY_URL).toBe('');
	});

	it('fails safely before changing the environment for invalid configuration', async () => {
		await writeFile(path, credentials(`  secret: '${sentinel}'\n`));
		const env = { CONFIG_PATH: path, ORIGIN: sentinel, AUTH_URL: sentinel };
		const before = { ...env };
		const error: unknown = await prepareRuntimeEnvironment(env).catch((error: unknown) => error);
		expect(error).toBeInstanceOf(DirectoryError);
		expect((error as DirectoryError).issue.code).toBe('load_failed');
		expect(String(error)).not.toContain(sentinel);
		expect(JSON.stringify(error)).not.toContain(sentinel);
		expect(JSON.stringify(error)).not.toContain(path);
		expect(env).toEqual(before);
	});

	it('redacts unreadable config paths', async () => {
		await expect(prepareRuntimeEnvironment({ CONFIG_PATH: path })).rejects.toMatchObject({
			issue: { code: 'load_failed', issues: [{ code: 'file_unreadable', path: '/' }] }
		});
	});
});
