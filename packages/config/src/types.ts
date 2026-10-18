import type { Static } from '@sinclair/typebox';
import type {
	AppearanceSchema,
	AuthSchema,
	CredentialsAuthSchema,
	LinkSchema,
	OidcAuthSchema,
	SiteSchema,
	DirectoryConfigurationSchema
} from './schema.js';

export type ConfigEnvironment = Readonly<Record<string, string | undefined>>;
export interface ConfigLoadOptions {
	env?: ConfigEnvironment;
}
export interface ConfigPathOptions extends ConfigLoadOptions {
	cwd?: string;
}

export type DirectoryConfiguration = Static<typeof DirectoryConfigurationSchema>;
export type DirectoryLink = Static<typeof LinkSchema>;
export type DirectorySite = Static<typeof SiteSchema>;
export type DirectoryAppearance = Static<typeof AppearanceSchema>;
export type DirectoryAuth = Static<typeof AuthSchema>;
export type DirectoryCredentialsAuth = Static<typeof CredentialsAuthSchema>;
export type DirectoryOidcAuth = Static<typeof OidcAuthSchema>;
