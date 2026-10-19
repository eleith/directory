import { spawn } from 'node:child_process';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

const serverModule = new URL('../../../build/index.js', import.meta.url).href;
const sentinel = 'PRIVATE_CONFIG_CREDENTIAL_LINK';
const credentialsConfiguration = `links: {}\nauth:\n  credentials:\n    username: ${sentinel}\n    password: ${sentinel}`;

function source(title: string): string {
	return `
site:
  title: ${title}
  description: ${title} description
links:
  private-service:
    title: ${sentinel}
    url: https://service.example.com/${sentinel}
`;
}

async function launchServer(contents: string | undefined, environment: NodeJS.ProcessEnv = {}) {
	const temporary = await mkdtemp(join(tmpdir(), 'directory-boot-'));
	onTestFinished(() => rm(temporary, { recursive: true, force: true }));
	const path = join(temporary, `${sentinel}.yaml`);
	if (contents !== undefined) await writeFile(path, contents);
	const script = `
import { once } from 'node:events';
const { server } = await import(${JSON.stringify(serverModule)});
if (!server.server.listening) await once(server.server, 'listening');
process.send(server.server.address().port);
`;
	const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
		cwd: temporary,
		env: {
			HOST: '127.0.0.1',
			PORT: '0',
			ORIGIN: 'http://localhost',
			AUTH_URL: 'http://localhost',
			CONFIG_PATH: path,
			NODE_ENV: 'production',
			SHUTDOWN_TIMEOUT: '1',
			...environment
		},
		stdio: ['ignore', 'pipe', 'pipe', 'ipc']
	});
	let output = '';
	let port: number | undefined;
	let finished = false;
	child.stdout!.setEncoding('utf8').on('data', (text: string) => (output += text));
	child.stderr!.setEncoding('utf8').on('data', (text: string) => (output += text));
	child.on('message', (message) => {
		if (typeof message === 'number') port = message;
	});
	const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
		(resolve, reject) => {
			child.once('error', reject);
			child.once('close', (code, signal) => {
				finished = true;
				resolve({ code, signal });
			});
		}
	);
	async function stop() {
		if (!finished) child.kill('SIGTERM');
		const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
		timeout.unref();
		try {
			return await closed;
		} finally {
			clearTimeout(timeout);
		}
	}
	onTestFinished(async () => {
		await stop();
	});
	return {
		path,
		closed,
		stop,
		output: () => output,
		async ready() {
			await vi.waitUntil(() => port !== undefined || finished, { timeout: 10_000 });
			expect(port, output).toBeTypeOf('number');
			return `http://127.0.0.1:${port}`;
		}
	};
}

async function expectPage(origin: string, title: string): Promise<void> {
	const response = await fetch(origin, { headers: { connection: 'close' } });
	expect(response.status).toBe(200);
	const html = await response.text();
	expect(html).toContain(`${title} — Homelab dashboard`);
	expect(html).toContain(`${title} description`);
	expect(html).not.toContain(sentinel);
}

async function expectHealthy(origin: string): Promise<void> {
	const response = await fetch(`${origin}/healthz`, { headers: { connection: 'close' } });
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ status: 'ok' });
}

describe('production configuration startup', () => {
	it.each([
		{ name: 'missing file', code: 'load_failed', contents: undefined },
		{ name: 'invalid YAML', code: 'load_failed', contents: `links: [\n${sentinel}` },
		{ name: 'invalid auth', code: 'load_failed', contents: 'links: {}\nauth: {}' },
		{
			name: 'missing environment value',
			code: 'load_failed',
			contents: `links:\n  photos:\n    title: Photos\n    url: '\${${sentinel}}'`
		},
		{
			name: 'credentials auth missing AUTH_SECRET',
			code: 'auth_failed',
			contents: credentialsConfiguration
		},
		{
			name: 'enabled auth without ORIGIN',
			code: 'auth_failed',
			contents: credentialsConfiguration,
			environment: { AUTH_SECRET: sentinel.repeat(2), ORIGIN: undefined }
		},
		{
			name: 'enabled auth without AUTH_URL',
			code: 'auth_failed',
			contents: credentialsConfiguration,
			environment: { AUTH_SECRET: sentinel.repeat(2), AUTH_URL: undefined }
		},
		{
			name: 'enabled auth over an HTTP IP address',
			code: 'auth_failed',
			contents: credentialsConfiguration,
			environment: {
				AUTH_SECRET: sentinel.repeat(2),
				ORIGIN: 'http://127.0.0.1',
				AUTH_URL: 'http://127.0.0.1'
			}
		},
		{
			name: 'enabled auth with a non-root ORIGIN',
			code: 'auth_failed',
			contents: credentialsConfiguration,
			environment: { AUTH_SECRET: sentinel.repeat(2), ORIGIN: `http://localhost/${sentinel}` }
		},
		{
			name: 'enabled auth with a trailing-slash ORIGIN',
			code: 'auth_failed',
			contents: credentialsConfiguration,
			environment: { AUTH_SECRET: sentinel.repeat(2), ORIGIN: 'http://localhost/' }
		},
		{
			name: 'enabled auth with a mismatched AUTH_URL',
			code: 'auth_failed',
			contents: credentialsConfiguration,
			environment: {
				AUTH_SECRET: sentinel.repeat(2),
				AUTH_URL: `https://foreign.example.com/${sentinel}`
			}
		},
		{
			name: 'OIDC auth missing AUTH_SECRET',
			code: 'auth_failed',
			contents: `links: {}\nauth:\n  oidc:\n    issuer: https://identity.example.com\n    client_id: ${sentinel}\n    client_secret: ${sentinel}`
		}
	])('rejects $name before opening a socket', async ({ contents, code, environment }) => {
		const server = await launchServer(contents, environment);
		const result = await server.closed;
		expect(result.signal).toBeNull();
		expect(result.code).not.toBe(0);
		const records = server
			.output()
			.split('\n')
			.filter((line) => line.startsWith('{'))
			.map((line) => JSON.parse(line) as unknown);
		expect(records).toContainEqual(
			expect.objectContaining({
				level: 'ERROR',
				message: `Application startup failed (${code}).`
			})
		);
		for (const record of records) {
			expect(record).not.toHaveProperty('error');
			expect(record).not.toHaveProperty('_logMeta.path');
		}
		expect(server.output()).not.toContain('Listening on');
		expect(server.output()).not.toContain(sentinel);
		expect(server.output()).not.toContain(server.path);
	});
});

it('polls atomic saves, retains last good across invalid/deleted files, and shuts down cleanly', async () => {
	const server = await launchServer(source('first'));
	const origin = await server.ready();
	await expectHealthy(origin);
	await expectPage(origin, 'first');

	const replacement = `${server.path}.replacement`;
	await writeFile(replacement, source('second'));
	await rename(replacement, server.path);
	await vi.waitFor(() => expectPage(origin, 'second'), { timeout: 5000, interval: 50 });

	await writeFile(server.path, `links: [\n${sentinel}`);
	await vi.waitFor(() => expect(server.output()).toContain('load_failed'), { timeout: 5000 });
	await expectPage(origin, 'second');
	await expectHealthy(origin);

	const beforeDeletion = server.output().split('load_failed').length;
	await rm(server.path);
	await vi.waitFor(
		() => expect(server.output().split('load_failed').length).toBeGreaterThan(beforeDeletion),
		{ timeout: 5000 }
	);
	await expectPage(origin, 'second');
	await expectHealthy(origin);

	await writeFile(server.path, source('third'));
	await vi.waitFor(() => expectPage(origin, 'third'), { timeout: 5000, interval: 50 });
	await writeFile(
		server.path,
		`${source('rejected')}\nauth:\n  credentials:\n    username: ${sentinel}\n    password: ${sentinel}`
	);
	await vi.waitFor(() => expect(server.output()).toContain('restart_required'), { timeout: 5000 });
	await expectPage(origin, 'third');
	await expectHealthy(origin);

	await writeFile(replacement, source('restored'));
	await rename(replacement, server.path);
	await vi.waitFor(() => expectPage(origin, 'restored'), { timeout: 5000, interval: 50 });
	expect(server.output()).not.toContain(sentinel);
	expect(server.output()).not.toContain(server.path);
	expect(await server.stop()).toEqual({ code: 0, signal: null });
}, 30_000);
