import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const connectSources = ['self'];
if (process.env.NODE_ENV === 'development') connectSources.push('ws:', 'wss:');

export default {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
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
	}
};
