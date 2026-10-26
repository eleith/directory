import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { prepareRuntimeEnvironment } from './src/lib/server/runtime-environment.js';
import Icons from 'unplugin-icons/vite';

export default defineConfig(async ({ command, mode, isPreview }) => {
	if (command === 'serve' && !isPreview) {
		Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
		await prepareRuntimeEnvironment();
		// Empty overrides stop Vite from restoring legacy URL values from dotenv files.
		process.env.ORIGIN ??= '';
		process.env.AUTH_URL ??= '';
	}
	return {
		optimizeDeps: { include: ['fuse.js'] },
		plugins: [
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
