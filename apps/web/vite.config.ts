import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	optimizeDeps: { include: ['fuse.js'] },
	plugins: [
		sveltekit(),
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
