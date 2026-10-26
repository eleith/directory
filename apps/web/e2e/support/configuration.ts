export const siteTitle = 'C6 Family Directory';
export const username = 'PRIVATE_C6_USERNAME';
export const password = 'PRIVATE_C6_PASSWORD_!a7';
export const clientId = 'PRIVATE_C6_OIDC_CLIENT';
export const clientSecret = 'PRIVATE_C6_CLIENT_SECRET_!q9';
export const privateDescription = 'PRIVATE_C6_SITE_DESCRIPTION';
export const privateSentinels = [
	username,
	password,
	clientId,
	clientSecret,
	privateDescription,
	'PRIVATE_C6_FOOTER',
	'PRIVATE_C6_SERVICE',
	'PRIVATE_C6_LINK_DESCRIPTION',
	'PRIVATE_C6_TAG',
	'https://private-service.example.test/C6'
];

export const credentialsAuth = `auth:
  origin: '\${TEST_ORIGIN}'
  credentials:
    username: ${JSON.stringify(username)}
    password: ${JSON.stringify(password)}
`;

export function oidcAuth(issuer: string): string {
	return `auth:
  origin: '\${TEST_ORIGIN}'
  oidc:
    issuer: ${JSON.stringify(issuer)}
    client_id: ${JSON.stringify(clientId)}
    client_secret: ${JSON.stringify(clientSecret)}
`;
}

export function configuration(auth = credentialsAuth, title = siteTitle): string {
	return `version: 1
site:
  title: ${JSON.stringify(title)}
  description: ${privateDescription}
  footer: PRIVATE_C6_FOOTER
links:
  household:
    title: PRIVATE_C6_SERVICE
    url: https://private-service.example.test/C6
    description: PRIVATE_C6_LINK_DESCRIPTION
    tags: [PRIVATE_C6_TAG]
    requires_auth: false
    internal_only: false
    admin_only: false
  administration:
    title: PRIVATE_C6_SERVICE_ADMIN
    url: https://private-service.example.test/C6/admin
    requires_auth: true
    internal_only: true
    admin_only: true
${auth}`;
}
