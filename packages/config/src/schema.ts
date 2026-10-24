import {
	FormatRegistry,
	Type,
	type SchemaOptions,
	type Static,
	type TSchema
} from '@sinclair/typebox';
import { configurationVersion } from './version.js';

const ref = <T extends TSchema>(schema: T, options?: SchemaOptions) => {
	if (typeof schema.$id !== 'string') throw new Error('Configuration reference needs an ID');
	return Type.Unsafe<Static<T>>(Type.Ref(schema.$id, options));
};

FormatRegistry.Set('directory-http-url', (value) => {
	try {
		if (/\s/.test(value)) return false;
		const url = new URL(value);
		return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
	} catch {
		return false;
	}
});

const nonEmptyText = { minLength: 1, pattern: '\\S' };
// Unlike $, this also rejects a final newline in identifiers, colors and paths.
const end = '(?![\\s\\S])';
const slugPattern = `^(?![0-9]+${end})(?!(?:prototype|constructor)${end})[a-z0-9]+(?:-[a-z0-9]+)*${end}`;
const imageSegment = '(?!\\.{1,2}(?:/|$))[^/%\\\\?#\\x00-\\x1f\\x7f]+';

export const HttpUrlSchema = Type.String({
	$id: 'HttpUrl',
	format: 'directory-http-url',
	pattern: '^[Hh][Tt][Tt][Pp][Ss]?://[^\\s]+$',
	description: 'An absolute HTTP or HTTPS URL. Relative and executable URLs are not accepted.'
});

export const LocalImagePathSchema = Type.String({
	$id: 'LocalImagePath',
	pattern: `^/public/(?:${imageSegment}/)*${imageSegment}\\.(?:[sS][vV][gG]|[pP][nN][gG]|[jJ][pP][eE]?[gG]|[gG][iI][fF]|[wW][eE][bB][pP])${end}`,
	description:
		'A decoded image path under /public/. Use SVG, PNG, JPEG, GIF or WebP; no dot segments, percent escapes, backslashes, queries or fragments.'
});

export const SiteImagePathSchema = Type.Union(
	[ref(LocalImagePathSchema), Type.Literal('/favicon.svg')],
	{ $id: 'SiteImagePath', description: 'A mounted image path or the bundled /favicon.svg mark.' }
);

export const HexColorSchema = Type.String({
	$id: 'HexColor',
	pattern: `^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})${end}`,
	description: 'A three- or six-digit hexadecimal color.'
});

export const TagsSchema = Type.String({
	$id: 'Tags',
	pattern: `^[^\\x00-\\x1f\\x7f]*${end}`,
	description: 'Comma-separated labels, not a map or list. Empty means no tags.'
});

export const LinkSchema = Type.Object(
	{
		title: Type.String({ ...nonEmptyText, description: 'Visible name of this link.' }),
		url: ref(HttpUrlSchema),
		description: Type.Optional(Type.String({ description: 'Plain text; multiline is supported.' })),
		logo_path: Type.Optional(ref(LocalImagePathSchema)),
		favicon_path: Type.Optional(ref(LocalImagePathSchema)),
		tags: ref(TagsSchema, { default: '' }),
		group: Type.Optional(
			Type.String({ ...nonEmptyText, description: 'Optional display group label.' })
		),
		requires_auth: Type.Boolean({
			default: false,
			description: 'Service sign-in hint only; does not enable Directory authentication.'
		}),
		internal_only: Type.Boolean({
			default: false,
			description: 'LAN/VPN availability hint only; does not check or restrict network access.'
		}),
		admin_only: Type.Boolean({
			default: false,
			description:
				'Intended-for-administrators hint only; does not hide the link or enforce a role.'
		})
	},
	{ $id: 'Link', additionalProperties: false }
);

export const SiteSchema = Type.Object(
	{
		title: Type.String({ ...nonEmptyText, default: 'Directory' }),
		description: Type.String({ default: '' }),
		logo_path: ref(SiteImagePathSchema, { default: '/favicon.svg' }),
		favicon_path: ref(SiteImagePathSchema, { default: '/favicon.svg' }),
		footer: Type.String({ default: '' })
	},
	{ $id: 'Site', additionalProperties: false }
);

export const AppearanceSchema = Type.Object(
	{
		primary_light_color: ref(HexColorSchema, { default: '#0f766e' }),
		primary_dark_color: ref(HexColorSchema, { default: '#5eead4' })
	},
	{ $id: 'Appearance', additionalProperties: false }
);

export const OidcAuthSchema = Type.Object(
	{
		issuer: ref(HttpUrlSchema),
		client_id: Type.String(nonEmptyText),
		client_secret: Type.String({ minLength: 1 })
	},
	{ $id: 'OidcAuth', additionalProperties: false }
);

export const CredentialsAuthSchema = Type.Object(
	{
		username: Type.String(nonEmptyText),
		password: Type.String({ minLength: 1 })
	},
	{ $id: 'CredentialsAuth', additionalProperties: false }
);

export const AuthSchema = Type.Union(
	[
		Type.Object(
			{ oidc: ref(OidcAuthSchema), credentials: Type.Optional(Type.Never()) },
			{ additionalProperties: false, title: 'OIDC' }
		),
		Type.Object(
			{ credentials: ref(CredentialsAuthSchema), oidc: Type.Optional(Type.Never()) },
			{ additionalProperties: false, title: 'Shared username and password' }
		)
	],
	{ $id: 'Auth', description: 'Declare exactly one strategy, or omit auth for an open dashboard.' }
);

export const DirectoryConfigurationSchema = Type.Object(
	{
		version: Type.Literal(configurationVersion, { default: configurationVersion }),
		site: ref(SiteSchema, { default: {} }),
		appearance: ref(AppearanceSchema, { default: {} }),
		auth: Type.Optional(ref(AuthSchema)),
		links: Type.Record(Type.String({ pattern: slugPattern }), ref(LinkSchema, { default: {} }), {
			additionalProperties: false,
			description: 'Links keyed by stable, non-numeric lowercase slugs. An empty map is allowed.'
		})
	},
	{ $id: 'DirectoryConfiguration', additionalProperties: false, title: 'Directory configuration' }
);

export const configurationReferences: TSchema[] = [
	HttpUrlSchema,
	LocalImagePathSchema,
	SiteImagePathSchema,
	HexColorSchema,
	TagsSchema,
	LinkSchema,
	SiteSchema,
	AppearanceSchema,
	OidcAuthSchema,
	CredentialsAuthSchema,
	AuthSchema
];
