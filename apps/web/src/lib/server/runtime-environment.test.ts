import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
site:
  url: '${origin}'
auth:
  credentials:
    username: family
    password: test-password
${extra}`;
}

describe('framework environment preparation', () => {
	it('captures the final Vite CLI port before Kit snapshots the stale framework origin', async () => {
		const web = fileURLToPath(new URL('../../../', import.meta.url));
		const vite = join(web, 'node_modules/vite/bin/vite.js');
		const host = '127.0.0.1';
		const socket = createServer();
		await new Promise<void>((resolve, reject) => {
			socket.once('error', reject);
			socket.listen(0, host, resolve);
		});
		const address = socket.address();
		await new Promise<void>((resolve, reject) =>
			socket.close((error) => (error ? reject(error) : resolve()))
		);
		if (address === null || typeof address === 'string') throw new Error('Expected a TCP port');
		const port = String(address.port);

		// Run the real Vite/Kit lifecycle without writing generated files into the working app.
		await mkdir(join(directory, 'src/routes'), { recursive: true });
		for (const file of ['src/app.html', 'svelte.config.js', 'tsconfig.json']) {
			await cp(join(web, file), join(directory, file));
		}
		await symlink(join(web, 'node_modules'), join(directory, 'node_modules'), 'dir');
		await writeFile(join(directory, 'package.json'), '{"type":"module"}');
		await writeFile(
			join(directory, 'vite.config.mjs'),
			`import config from ${JSON.stringify(join(web, 'vite.config.ts'))};
export default (env) => {
  const result = config(env);
  return { ...result, cacheDir: ${JSON.stringify(join(directory, '.vite'))},
    server: { ...result.server, fs: { allow: ${JSON.stringify([directory, web])} } } };
};`
		);
		await writeFile(path, 'links: {}');
		await writeFile(
			join(directory, '.env'),
			'PORT=2\nORIGIN=https://stale.example.com\nAUTH_URL=https://stale.example.com\n'
		);
		await writeFile(
			join(directory, 'src/routes/+page.server.js'),
			`import { env } from '$env/dynamic/private';
export const load = () => ({ settings: env.ORIGIN + '|' + process.env.PORT });`
		);
		await writeFile(
			join(directory, 'src/routes/+page.svelte'),
			'<script>let { data } = $props();</script><p>{data.settings}</p>'
		);
		const env = { ...process.env };
		for (const key of ['SOCKET_PATH', 'LISTEN_FDS', 'ORIGIN', 'AUTH_URL', 'VITEST'])
			delete env[key];
		const child = spawn(
			process.execPath,
			[vite, '--host', host, '--configLoader', 'runner', '--port', port],
			{
				cwd: directory,
				env: { ...env, NODE_ENV: 'development', PORT: '1', CONFIG_PATH: path },
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
		let output = '';
		let failure: Error | undefined;
		child.stdout.setEncoding('utf8').on('data', (text: string) => (output += text));
		child.stderr.setEncoding('utf8').on('data', (text: string) => (output += text));
		child.once('error', (error) => (failure = error));
		const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
		try {
			// Probe HTTP, not Vite's console URL (which changes with CI and ANSI colors).
			const html = await vi.waitFor(
				async () => {
					expect(failure, output).toBeUndefined();
					expect(child.exitCode, output).toBeNull();
					const response = await fetch(`http://${host}:${port}/`, {
						headers: { connection: 'close' },
						signal: AbortSignal.timeout(5000)
					});
					const html = await response.text();
					expect(response.status, `${output}\n${html}`).toBe(200);
					return html;
				},
				{ timeout: 20_000 }
			);
			expect(html).toContain(`http://localhost:${port}|${port}`);
		} finally {
			child.kill('SIGTERM');
			const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
			try {
				await closed;
			} finally {
				clearTimeout(timeout);
			}
		}
	}, 30_000);

	it('uses site.url instead of legacy framework settings', async () => {
		await writeFile(path, credentials());
		const env = {
			CONFIG_PATH: path,
			ORIGIN: sentinel,
			AUTH_URL: sentinel,
			NEXTAUTH_URL: sentinel,
			AUTH_REDIRECT_PROXY_URL: sentinel,
			AUTH_SECRET: sentinel
		};
		const before = { ...env };
		await prepareRuntimeEnvironment(env);
		expect(env).toEqual({ ...before, ORIGIN: origin });
	});

	it.each([
		{ settings: {}, expected: 'http://localhost:3000' },
		{ settings: { NODE_ENV: 'development' }, expected: 'http://localhost:5173' },
		{ settings: { NODE_ENV: 'production', PORT: '8080' }, expected: 'http://localhost:8080' }
	])(
		'sets canonical framework URLs for an open directory: $expected',
		async ({ settings, expected }) => {
			await writeFile(path, 'links: {}');
			const env = {
				CONFIG_PATH: path,
				ORIGIN: sentinel,
				AUTH_URL: sentinel,
				NEXTAUTH_URL: sentinel,
				AUTH_REDIRECT_PROXY_URL: sentinel,
				...settings
			};
			await prepareRuntimeEnvironment(env);
			expect(env.ORIGIN).toBe(expected);
			expect(env.AUTH_URL).toBe(sentinel);
		}
	);

	it('uses an explicit site.url even with auth disabled and an ephemeral listen port', async () => {
		await writeFile(path, `site:\n  url: '${origin}'\nlinks: {}`);
		const env = { CONFIG_PATH: path, PORT: '0', ORIGIN: sentinel, AUTH_URL: sentinel };
		await prepareRuntimeEnvironment(env);
		expect(env.ORIGIN).toBe(origin);
		expect(env.AUTH_URL).toBe(sentinel);
	});

	it('preserves explicit legacy-named environment interpolation in YAML', async () => {
		await writeFile(path, credentials().replace(origin, '${ORIGIN}'));
		const env = { CONFIG_PATH: path, ORIGIN: origin, AUTH_URL: sentinel };
		await prepareRuntimeEnvironment(env);
		expect(env.ORIGIN).toBe(origin);
		expect(env.AUTH_URL).toBe(sentinel);
	});

	it.each([{ PORT: '0' }, { SOCKET_PATH: '/tmp/directory.sock' }, { LISTEN_FDS: '1' }])(
		'fails safely without site.url for a nonstandard listener: %j',
		async (settings) => {
			await writeFile(path, 'links: {}');
			const env = {
				CONFIG_PATH: path,
				ORIGIN: sentinel,
				AUTH_URL: sentinel,
				NEXTAUTH_URL: sentinel,
				AUTH_REDIRECT_PROXY_URL: sentinel,
				...settings
			};
			const before = { ...env };
			await expect(prepareRuntimeEnvironment(env)).rejects.toMatchObject({
				issue: {
					code: 'load_failed',
					issues: [expect.objectContaining({ code: 'invalid_value', path: '/site/url' })]
				}
			});
			expect(env).toEqual(before);
		}
	);

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
