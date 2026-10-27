import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { prepareRuntimeEnvironment } from './src/lib/server/runtime-environment.js';
import Icons from 'unplugin-icons/vite';

export default defineConfig(({ command, mode, isPreview }) => {
	const development = command === 'serve' && !isPreview;
	if (development) {
		Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
	}
	const port = Number(process.env.PORT ?? 5173);
	return {
		server: { port, strictPort: true },
		optimizeDeps: { include: ['fuse.js'] },
		plugins: [
			{
				name: 'directory-dev-environment',
				enforce: 'pre',
				config: {
					order: 'pre',
					async handler(config) {
						if (!development) return;
						// CLI overrides are merged before config hooks. Kit snapshots env in its own
						// config hook, so configResolved would leave $env/dynamic/private stale.
						process.env.PORT = String(config.server?.port ?? 5173);
						await prepareRuntimeEnvironment();
					}
				}
			},
			sveltekit(),
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
