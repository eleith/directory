import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		// Kit's SSR loader does not run import.meta.hot.dispose.
		{
			name: 'where-dev-cleanup',
			apply: 'serve',
			closeBundle() {
				process.emit('where:dev-stop');
			}
		}
	]
});
