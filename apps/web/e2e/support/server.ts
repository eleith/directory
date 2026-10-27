import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const serverModule = new URL('../../build/bootstrap/start.js', import.meta.url).href;
const outputLimit = 64 * 1024;

export function randomSecret(): string {
	return randomBytes(48).toString('base64url');
}

async function reservePort(): Promise<number> {
	const reservation = createServer();
	await new Promise<void>((resolve, reject) => {
		reservation.once('error', reject);
		reservation.listen(0, '127.0.0.1', resolve);
	});
	const address = reservation.address();
	if (!address || typeof address === 'string') throw new Error('No reserved TCP port');
	await new Promise<void>((resolve, reject) => {
		reservation.close((error) => (error ? reject(error) : resolve()));
	});
	return address.port;
}

interface ServerOptions {
	configuration: string;
	publicDir?: string;
	/** Explicit YAML secret; omitted by default so the runtime generates its own. */
	secret?: string;
	/** Value for an explicit fixture site.url: '${TEST_ORIGIN}'; defaults to the allocated URL. */
	origin?: string;
	port?: number;
	/** Deliberately injected process env, e.g. hostile legacy auth settings. */
	env?: NodeJS.ProcessEnv;
}

/** A real bootstrap/adapter process; inherits no operator configuration or environment. */
export async function startServer(options: ServerOptions) {
	const temporary = await mkdtemp(join(tmpdir(), 'directory-auth-e2e-'));
	const path = join(temporary, 'directory.yaml');
	// Fixture YAML keeps auth at the top level; apply the same secret on reload.
	const renderConfiguration = (configuration: string) => {
		if (options.secret === undefined) return configuration;
		if (!/^auth:\n/m.test(configuration)) throw new Error('A test secret requires an auth block');
		return configuration.replace(/^auth:\n/m, "auth:\n  secret: '${TEST_AUTH_SECRET}'\n");
	};
	try {
		await writeFile(path, renderConfiguration(options.configuration));
		const publicDir = options.publicDir ?? join(temporary, 'public');
		if (options.publicDir === undefined) await mkdir(publicDir);
		const port = options.port ?? (await reservePort());
		const url = `http://localhost:${port}`;
		const origin = options.origin ?? url;
		const secret = options.secret;
		const environment: NodeJS.ProcessEnv = {
			...options.env,
			TEST_ORIGIN: origin,
			TEST_AUTH_SECRET: secret,
			HOST: '127.0.0.1',
			PORT: String(port),
			CONFIG_PATH: path,
			DIRECTORY_PUBLIC_DIR: publicDir,
			NODE_ENV: 'production',
			SHUTDOWN_TIMEOUT: '1'
		};
		const script = `
import { once } from 'node:events';
const { server } = await import(${JSON.stringify(serverModule)});
if (!server.server.listening) await once(server.server, 'listening');
process.send({ ready: server.server.address().port });
`;
		const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
			cwd: temporary,
			env: environment,
			stdio: ['ignore', 'pipe', 'pipe', 'ipc']
		});
		let output = '';
		let truncated = false;
		let finished = false;
		let listening = false;
		const capture = (text: string) => {
			output += text;
			if (Buffer.byteLength(output) > outputLimit) {
				truncated = true;
				output = output.slice(-outputLimit / 2);
			}
		};
		child.stdout!.setEncoding('utf8').on('data', capture);
		child.stderr!.setEncoding('utf8').on('data', capture);
		child.on('message', (message: unknown) => {
			if (typeof message === 'object' && message !== null && 'ready' in message) {
				listening = message.ready === port;
			}
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
		// Keep IPC connected until exit: early disconnect loses Node 26 close bookkeeping.
		async function stop() {
			if (!finished) child.kill('SIGTERM');
			const kill = setTimeout(() => child.kill('SIGKILL'), 5_000);
			kill.unref();
			let deadline: ReturnType<typeof setTimeout> | undefined;
			const timedOut = new Promise<never>((_, reject) => {
				deadline = setTimeout(
					() => reject(new Error('Adapter process did not close after SIGKILL')),
					10_000
				);
				deadline.unref();
			});
			try {
				return await Promise.race([closed, timedOut]);
			} finally {
				clearTimeout(kill);
				clearTimeout(deadline);
				await rm(temporary, { recursive: true, force: true });
			}
		}
		return {
			url,
			origin,
			port,
			secret,
			path,
			closed,
			stop,
			output: () => output,
			outputTruncated: () => truncated,
			async ready() {
				const deadline = Date.now() + 15_000;
				while (!listening && !finished && Date.now() < deadline) await delay(25);
				if (!listening) throw new Error(`Adapter failed to become ready: ${output}`);
			},
			async replace(configuration: string) {
				await writeFile(`${path}.replacement`, renderConfiguration(configuration));
				await rename(`${path}.replacement`, path);
			},
			fetch(pathname: string, init: RequestInit = {}) {
				return fetch(new URL(pathname, url), {
					...init,
					redirect: 'manual',
					signal: AbortSignal.timeout(5_000),
					headers: { connection: 'close', ...Object.fromEntries(new Headers(init.headers)) }
				});
			}
		};
	} catch (error) {
		await rm(temporary, { recursive: true, force: true });
		throw error;
	}
}

export type TestServer = Awaited<ReturnType<typeof startServer>>;
