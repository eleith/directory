import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import {
	createServer as createHttpServer,
	type IncomingMessage,
	type ServerResponse
} from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectoryError } from './directory-error.js';
import {
	installRequestOrigin,
	prepareAdapterEnvironment,
	prepareRuntimeEnvironment,
	PUBLIC_AUTHORITY_HEADER,
	PUBLIC_PROTOCOL_HEADER
} from './runtime-environment.js';

const origin = 'https://directory.example.com';
const sentinel = 'PRIVATE-runtime-setting';
let directory: string;
let path: string;

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

describe('runtime environment preparation', () => {
	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'directory-runtime-'));
		path = join(directory, 'directory.yaml');
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it('loads tooling configuration without requiring operator YAML', () => {
		const web = fileURLToPath(new URL('../../../', import.meta.url));
		const script = `
import { loadConfig } from ${JSON.stringify(import.meta.resolve('@sveltejs/load-config'))};
const result = await loadConfig(${JSON.stringify(web)}, { traverse: false });
if (!result) throw new Error('Svelte configuration not found');
if ('error' in result) throw result.error;
`;
		const env: NodeJS.ProcessEnv = { ...process.env, CONFIG_PATH: path };
		delete env.VITEST;
		const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
			cwd: web,
			env,
			encoding: 'utf8',
			timeout: 20_000
		});
		expect(result.status, result.stdout + result.stderr).toBe(0);
	}, 30_000);

	it('uses the final Vite CLI port for request URLs despite stale environment settings', async () => {
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

		await mkdir(join(directory, 'src/routes'), { recursive: true });
		for (const file of ['src/app.html', 'tsconfig.json']) {
			await cp(join(web, file), join(directory, file));
		}
		// Kit 3 must generate this fixture's own node_modules/$app, not overwrite the app's.
		await mkdir(join(directory, 'node_modules'));
		for (const name of await readdir(join(web, 'node_modules'))) {
			if (name.startsWith('.') || name === '$app') continue;
			await symlink(join(web, 'node_modules', name), join(directory, 'node_modules', name), 'dir');
		}
		await writeFile(join(directory, 'package.json'), '{"type":"module"}');
		await writeFile(
			join(directory, 'vite.config.mjs'),
			`import config from ${JSON.stringify(join(web, 'vite.config.ts'))};
export default (env) => {
  const result = config(env);
  return { ...result, cacheDir: ${JSON.stringify(join(directory, '.vite'))},
    server: { ...result.server, fs: { allow: ${JSON.stringify([directory, join(web, '../..')])} } } };
};`
		);
		await writeFile(path, 'links: {}');
		await writeFile(
			join(directory, 'src/hooks.server.ts'),
			`export { init, handle } from ${JSON.stringify(join(web, 'src/hooks.server.ts'))};`
		);
		await writeFile(
			join(directory, '.env'),
			'PORT=2\nORIGIN=https://stale.example.com\nAUTH_URL=https://stale.example.com\n'
		);
		await writeFile(
			join(directory, 'src/routes/+page.server.js'),
			`export const load = ({ url }) => ({ settings: url.origin + '|' + process.env.PORT });`
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
				env: {
					...env,
					NODE_ENV: 'development',
					PORT: '1',
					CONFIG_PATH: path,
					DIRECTORY_PUBLIC_DIR: join(directory, 'public')
				},
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
			const html = await vi.waitFor(
				async () => {
					expect(failure, output).toBeUndefined();
					expect(child.exitCode, output).toBeNull();
					const response = await fetch(`http://${host}:${port}/`, {
						headers: {
							connection: 'close',
							[PUBLIC_PROTOCOL_HEADER]: 'https',
							[PUBLIC_AUTHORITY_HEADER]: 'foreign.example.com'
						},
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

	it('uses YAML site.url without treating legacy framework settings as configuration', async () => {
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
		const runtime = await prepareRuntimeEnvironment(env);
		expect(runtime.origin).toBe(origin);
		expect(runtime.env).toEqual(before);
		expect(env).toEqual(before);
	});

	it.each([
		{ settings: {}, expected: 'http://localhost:3000' },
		{ settings: { NODE_ENV: 'development' }, expected: 'http://localhost:5173' },
		{ settings: { NODE_ENV: 'production', PORT: '8080' }, expected: 'http://localhost:8080' }
	])(
		'prepares the default origin for an open directory: $expected',
		async ({ settings, expected }) => {
			await writeFile(path, 'links: {}');
			const runtime = await prepareRuntimeEnvironment({ CONFIG_PATH: path, ...settings });
			expect(runtime.origin).toBe(expected);
		}
	);

	it('keeps interpolation values captured before transport settings are changed', async () => {
		await writeFile(path, credentials().replace(origin, '${ORIGIN}'));
		const env = {
			CONFIG_PATH: path,
			PORT: '0',
			ORIGIN: origin,
			HOST_HEADER: 'original-host',
			PROTOCOL_HEADER: 'original-protocol',
			PORT_HEADER: 'original-port',
			AUTH_SECRET: sentinel
		};
		const before = { ...env };
		const runtime = await prepareRuntimeEnvironment(env);
		prepareAdapterEnvironment(env);
		expect(runtime.origin).toBe(origin);
		expect(runtime.env).toEqual(before);
		expect(env.ORIGIN).toBeUndefined();
		expect(env).toMatchObject({
			HOST_HEADER: PUBLIC_AUTHORITY_HEADER,
			PROTOCOL_HEADER: PUBLIC_PROTOCOL_HEADER,
			PORT_HEADER: '',
			AUTH_SECRET: sentinel
		});
	});

	it.each([{ PORT: '0' }, { SOCKET_PATH: '/tmp/directory.sock' }, { LISTEN_FDS: '1' }])(
		'fails safely without site.url for a nonstandard listener: %j',
		async (settings) => {
			await writeFile(path, 'links: {}');
			await expect(
				prepareRuntimeEnvironment({ CONFIG_PATH: path, ...settings })
			).rejects.toMatchObject({
				issue: {
					code: 'load_failed',
					issues: [expect.objectContaining({ code: 'invalid_value', path: '/site/url' })]
				}
			});
		}
	);

	it('redacts invalid configuration without changing the caller environment', async () => {
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

it.each([
	{
		origin: 'https://directory.example.com:8443',
		protocol: 'https',
		authority: 'directory.example.com:8443'
	},
	{ origin: 'http://[::1]:8080', protocol: 'http', authority: '[::1]:8080' }
])(
	'overwrites private headers before the adapter sees $origin, without rewriting browser Origin',
	({ origin, protocol, authority }) => {
		let received: IncomingMessage['headers'] | undefined;
		const server = createHttpServer((request) => {
			received = { ...request.headers };
		});
		installRequestOrigin(server, origin);
		const request = {
			headers: {
				host: 'foreign.example.com',
				origin: 'https://foreign.example.com',
				'x-forwarded-host': 'foreign.example.com',
				[PUBLIC_PROTOCOL_HEADER]: 'https',
				[PUBLIC_AUTHORITY_HEADER]: 'foreign.example.com'
			}
		} as unknown as IncomingMessage;
		server.emit('request', request, {} as ServerResponse);
		expect(received).toEqual({
			host: 'foreign.example.com',
			origin: 'https://foreign.example.com',
			'x-forwarded-host': 'foreign.example.com',
			[PUBLIC_PROTOCOL_HEADER]: protocol,
			[PUBLIC_AUTHORITY_HEADER]: authority
		});
	}
);
