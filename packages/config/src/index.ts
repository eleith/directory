export { configurationVersion } from './version.js';
export { WhereConfigurationSchema, configurationReferences } from './schema.js';
export { loadConfigFile, validateConfig } from './load.js';
export { ConfigError } from './errors.js';
export type { ConfigIssue, ConfigIssueCode } from './errors.js';
export { resolveConfigPath, resolveDeploymentRoot, resolvePublicDir } from './paths.js';
export type {
	ConfigEnvironment,
	ConfigLoadOptions,
	ConfigPathOptions,
	WhereConfiguration,
	WhereLink,
	WhereSite,
	WhereAppearance,
	WhereAuth,
	WhereCredentialsAuth,
	WhereOidcAuth
} from './types.js';
