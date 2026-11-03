import adapter from '@sveltejs/adapter-node';
import type { Adapter } from '@sveltejs/kit';
import { getRequest } from '@sveltejs/kit/node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { prepareRuntimeEnvironment } from './src/lib/server/runtime-environment.js';
import Icons from 'unplugin-icons/vite';

const connectSources: ('self' | 'ws:' | 'wss:')[] = ['self'];

if (process.env.NODE_ENV === 'development') connectSources.push('ws:', 'wss:');

function createAdapter(getOrigin: () => string | undefined): Adapter {
	const native = adapter();
	const nativeVite = native.vite;
	return {
		...native,
		vite: (context) => {
			const settings = typeof nativeVite === 'function' ? nativeVite(context) : nativeVite;
			return {
				...settings,
				getRequest: (options) => getRequest({ ...options, base: getOrigin() ?? options.base })
			};
		}
	};
}

export default defineConfig(({ command, mode, isPreview }) => {
	const development = command === 'serve' && !isPreview;
	const environment = development ? loadEnv(mode, process.cwd(), '') : undefined;
	const port = Number(environment?.PORT ?? process.env.PORT ?? 5173);
	let origin: string | undefined;
	return {
		server: { port, strictPort: true },
		optimizeDeps: { include: ['fuse.js'] },
		plugins: [
			{
				name: 'directory-dev-environment',
				enforce: 'pre',
				async configureServer(server) {
					if (!development) return;
					Object.assign(process.env, environment);
					// Config discovery also uses command=serve. Wait for a real dev server,
					// after CLI overrides, before reading operator YAML.
					process.env.PORT = String(server.config.server.port ?? 5173);
					origin = (await prepareRuntimeEnvironment()).origin;
				}
			},

			sveltekit({
				preprocess: vitePreprocess(),
				adapter: createAdapter(() => origin),
				csp: {
					// OIDC form redirects cross origins; state-changing requests are checked server-side.
					directives: {
						'default-src': ['self'],
						'script-src': ['self'],
						'style-src': ['self', 'unsafe-inline'],
						'img-src': ['self'],
						'font-src': ['self'],
						'connect-src': connectSources,
						'object-src': ['none'],
						'base-uri': ['self'],
						'frame-ancestors': ['none']
					}
				}
			}),
			Icons({ compiler: 'svelte' }),
			// Kit's SSR loader does not run import.meta.hot.dispose.
			{
				name: 'directory-dev-cleanup',
				apply: 'serve',
				closeBundle() {
					process.emit('directory:dev-stop');
				}
			}
		]
	};
});
