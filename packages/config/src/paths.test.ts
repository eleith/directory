import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfigPath, resolveDeploymentRoot, resolvePublicDir } from './paths.js';

describe('operational paths', () => {
	const cwd = resolve('/deployment');

	it('uses one default independent of NODE_ENV or nearby files', () => {
		for (const NODE_ENV of ['development', 'production', 'test']) {
			expect(resolveConfigPath({ cwd, env: { NODE_ENV } })).toBe(resolve(cwd, 'config/where.yaml'));
		}
	});

	it('resolves relative and absolute CONFIG_PATH overrides', () => {
		expect(resolveConfigPath({ cwd, env: { CONFIG_PATH: 'mounted/settings.yml' } })).toBe(
			resolve(cwd, 'mounted/settings.yml')
		);
		expect(resolveConfigPath({ cwd, env: { CONFIG_PATH: '/mounted/settings.yml' } })).toBe(
			resolve('/mounted/settings.yml')
		);
	});

	it('finds the sibling deployment public directory', () => {
		const configPath = resolve(cwd, 'config/where.yaml');
		expect(resolveDeploymentRoot(configPath)).toBe(cwd);
		expect(resolvePublicDir(configPath, { cwd, env: {} })).toBe(resolve(cwd, 'public'));
		expect(resolvePublicDir('config/where.yaml', { cwd, env: {} })).toBe(resolve(cwd, 'public'));
	});

	it('resolves public overrides from the working directory', () => {
		const configPath = resolve(cwd, 'config/where.yaml');
		expect(resolvePublicDir(configPath, { cwd, env: { WHERE_PUBLIC_DIR: 'assets' } })).toBe(
			resolve(cwd, 'assets')
		);
		expect(
			resolvePublicDir(configPath, { cwd, env: { WHERE_PUBLIC_DIR: '/mounted/assets' } })
		).toBe(resolve('/mounted/assets'));
	});
});
