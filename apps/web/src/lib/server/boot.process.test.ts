import { spawn } from 'node:child_process';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

const serverModule = new URL('../../../build/bootstrap/start.js', import.meta.url).href;
const sentinel = 'PRIVATE_CONFIG_CREDENTIAL_LINK';
const bookmarkTitle = 'Visible household bookmark';
const credentialsConfiguration = `links: {}\nauth:\n  origin: http://localhost\n  credentials:\n    username: ${sentinel}\n    password: ${sentinel}`;
const hostileEnvironment = {
	ORIGIN: `https://foreign.example.com/${sentinel}`,
	AUTH_URL: `malformed-${sentinel}`,
	AUTH_SECRET: 'short',
	NEXTAUTH_URL: `https://foreign.example.com/${sentinel}`,
	AUTH_REDIRECT_PROXY_URL: `https://proxy.example.com/${sentinel}`
};

function source(title: string): string {
	return `
site:
  title: ${title}
  description: ${title} description
links:
  private-service:
    title: ${bookmarkTitle}
    url: https://service.example.com/household
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
		socketOpened: () => port !== undefined,
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
	expect(html).toContain(`<title>${title}</title>`);
	expect(html).toContain(`${title} description`);
	expect(html).toContain(bookmarkTitle);
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
			name: 'credentials auth missing YAML origin',
			code: 'load_failed',
			contents: credentialsConfiguration.replace('  origin: http://localhost\n', '')
		}
	])('rejects $name before opening a socket', async ({ contents, code }) => {
		const server = await launchServer(contents, hostileEnvironment);
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
			expect(record).not.toHaveProperty('cause');
			expect(record).not.toHaveProperty('_logMeta.path');
		}
		expect(server.socketOpened()).toBe(false);
		expect(server.output()).not.toContain('Listening on');
		expect(server.output()).not.toContain('foreign.example.com');
		expect(server.output()).not.toContain('proxy.example.com');
		for (const value of Object.values(hostileEnvironment)) {
			if (value !== undefined) expect(server.output()).not.toContain(value);
		}
		expect(server.output()).not.toContain(sentinel);
		expect(server.output()).not.toContain(server.path);
	});
});

it.each([
	{
		name: 'without legacy environment or a YAML secret',
		environment: {},
		contents: credentialsConfiguration
	},
	{
		name: 'ignoring conflicting legacy environment',
		environment: hostileEnvironment,
		contents: credentialsConfiguration
	},
	{
		name: 'with explicit legacy-named environment references',
		environment: { ORIGIN: 'http://localhost', AUTH_SECRET: sentinel },
		contents: credentialsConfiguration
			.replace('origin: http://localhost', 'origin: ${ORIGIN}')
			.replace(`password: ${sentinel}`, 'password: ${AUTH_SECRET}')
	}
])('starts YAML credentials auth $name', async ({ environment, contents }) => {
	const server = await launchServer(contents, environment);
	const address = await server.ready();
	await expectHealthy(address);
	const gated = await fetch(address, {
		redirect: 'manual',
		headers: { accept: 'text/html', connection: 'close' }
	});
	expect(gated.status).toBe(303);
	const target = new URL(gated.headers.get('location')!, 'http://localhost');
	expect(target.origin).toBe('http://localhost');
	expect(target.pathname).toBe('/signin');
	const response = await fetch(`${address}/signin`, {
		method: 'POST',
		redirect: 'manual',
		headers: { origin: 'http://localhost', accept: 'text/html', connection: 'close' },
		body: new URLSearchParams({ username: sentinel, password: sentinel, redirectTo: '/' })
	});
	expect([302, 303]).toContain(response.status);
	expect(new URL(response.headers.get('location')!, 'http://localhost').href).toBe(
		'http://localhost/'
	);
	const cookie = response.headers.getSetCookie().find((value) => value.includes('session-token='));
	expect(cookie).toBeDefined();
	const authenticated = await fetch(address, {
		redirect: 'manual',
		headers: { cookie: cookie!.split(';')[0]!, connection: 'close' }
	});
	expect(authenticated.status).toBe(200);
	expect(await authenticated.text()).not.toContain(sentinel);
	expect(server.output()).not.toContain(sentinel);
	expect(server.output()).not.toContain(server.path);
	expect(server.output()).not.toContain('auth_failed');
	expect(await server.stop()).toEqual({ code: 0, signal: null });
});

it('keeps application environment references and fallbacks stable across bootstrap and reloads', async () => {
	const fallbackTitle = '${DIRECTORY_TITLE} ${MISSING_TITLE:-Fallback}';
	const title = 'Configured Fallback';
	const server = await launchServer(source(fallbackTitle), {
		...hostileEnvironment,
		DIRECTORY_TITLE: 'Configured'
	});
	const address = await server.ready();
	await expectPage(address, title);
	await writeFile(server.path, source(`${fallbackTitle} reloaded`));
	await vi.waitFor(() => expectPage(address, `${title} reloaded`), { timeout: 5000 });
	await expectHealthy(address);
	expect(server.output()).not.toContain('load_failed');
	expect(server.output()).not.toContain('restart_required');
	expect(server.output()).not.toContain(sentinel);
	expect(server.output()).not.toContain(server.path);
	expect(await server.stop()).toEqual({ code: 0, signal: null });
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
		`${source('rejected')}\nauth:\n  origin: http://localhost\n  credentials:\n    username: ${sentinel}\n    password: ${sentinel}`
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
