import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

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
			'.pnpm-store/**'
		]
	},
	js.configs.recommended,
	ts.configs.recommended,
	prettier,
	{ languageOptions: { globals: globals.node } }
);
