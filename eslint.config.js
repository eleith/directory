import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import { loadConfig } from '@sveltejs/load-config';
import { fileURLToPath } from 'node:url';

const loadedConfig = await loadConfig(fileURLToPath(new URL('./apps/web', import.meta.url)), {
	traverse: false
});
if (!loadedConfig) throw new Error('Svelte configuration not found');
if ('error' in loadedConfig) throw loadedConfig.error;
const svelteConfig = loadedConfig.config;

export default defineConfig(
	{
		ignores: [
			'**/node_modules/**',
			'**/.svelte-kit/**',
			'**/build/**',
			'**/dist/**',
			'**/coverage/**',
			'**/playwright-report/**',
			'**/test-results/**',
			'.pnpm-store/**',
			'demo/**'
		]
	},
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{ languageOptions: { globals: globals.node } },
	{
		files: ['**/*.svelte'],
		languageOptions: {
			globals: globals.browser,
			parserOptions: { parser: ts.parser, svelteConfig }
		}
	}
);
