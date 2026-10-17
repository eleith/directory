import { dirname, resolve } from 'node:path';
import type { ConfigPathOptions } from './types.js';

export function resolveConfigPath(options: ConfigPathOptions = {}): string {
	const env = options.env ?? process.env;
	const cwd = options.cwd ?? process.cwd();
	return resolve(cwd, env.CONFIG_PATH ?? 'config/where.yaml');
}

export function resolveDeploymentRoot(configPath: string): string {
	return dirname(dirname(resolve(configPath)));
}

export function resolvePublicDir(configPath: string, options: ConfigPathOptions = {}): string {
	const env = options.env ?? process.env;
	const cwd = options.cwd ?? process.cwd();
	if (env.WHERE_PUBLIC_DIR !== undefined) return resolve(cwd, env.WHERE_PUBLIC_DIR);
	return resolve(resolveDeploymentRoot(resolve(cwd, configPath)), 'public');
}
