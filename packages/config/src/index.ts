export { configurationVersion } from './version.js';
export { DirectoryConfigurationSchema, configurationReferences } from './schema.js';
export { loadConfigFile, validateConfig } from './load.js';
export { startConfigReloading } from './monitor.js';
export { isSameConfiguration } from './compare.js';
export { ConfigError } from './errors.js';
export type { ConfigIssue, ConfigIssueCode } from './errors.js';
export { resolveConfigPath, resolveDeploymentRoot, resolvePublicDir } from './paths.js';
export type {
	ConfigEnvironment,
	ConfigLoadOptions,
	ConfigPathOptions,
	DirectoryConfiguration,
	DirectoryLink,
	DirectorySite,
	DirectoryAppearance,
	DirectoryAuth,
	DirectoryCredentialsAuth,
	DirectoryOidcAuth
} from './types.js';
