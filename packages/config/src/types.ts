import type { Static } from '@sinclair/typebox';
import type {
	AppearanceSchema,
	AuthSchema,
	CredentialsAuthSchema,
	LinkSchema,
	OidcAuthSchema,
	SiteSchema,
	WhereConfigurationSchema
} from './schema.js';

export type ConfigEnvironment = Readonly<Record<string, string | undefined>>;
export interface ConfigLoadOptions {
	env?: ConfigEnvironment;
}
export interface ConfigPathOptions extends ConfigLoadOptions {
	cwd?: string;
}

export type WhereConfiguration = Static<typeof WhereConfigurationSchema>;
export type WhereLink = Static<typeof LinkSchema>;
export type WhereSite = Static<typeof SiteSchema>;
export type WhereAppearance = Static<typeof AppearanceSchema>;
export type WhereAuth = Static<typeof AuthSchema>;
export type WhereCredentialsAuth = Static<typeof CredentialsAuthSchema>;
export type WhereOidcAuth = Static<typeof OidcAuthSchema>;
