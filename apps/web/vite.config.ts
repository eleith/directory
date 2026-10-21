import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import Icons from 'unplugin-icons/vite';

export default defineConfig({
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
});
