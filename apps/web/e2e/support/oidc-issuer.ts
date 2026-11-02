import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { clientId, clientSecret } from './configuration.js';

type Scenario =
	| 'normal'
	| 'bad-state'
	| 'bad-nonce'
	| 'bad-issuer'
	| 'bad-audience'
	| 'malformed-token'
	| 'expired-token'
	| 'token-outage'
	| 'discovery-outage'
	| 'discovery-issuer';

interface Authorization {
	code: string;
	state: string;
	nonce: string;
	challenge: string;
	redirectUri: string;
	used: boolean;
	scenario: Scenario;
}

function json(response: ServerResponse, status: number, body: unknown) {
	response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
	response.end(JSON.stringify(body));
}

async function body(request: IncomingMessage): Promise<URLSearchParams> {
	let text = '';
	for await (const chunk of request) {
		text += String(chunk);
		if (text.length > 16_384) throw new Error('Fixture request too large');
	}
	return new URLSearchParams(text);
}

/** Test-only IdP. Scenarios are controlled in-process, never by public HTTP knobs. */
export async function startIssuer() {
	const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'c6-key', use: 'sig', alg: 'RS256' };
	const authorizations: Authorization[] = [];
	const tokens: string[] = [];
	const grants: { code: string; verifier: string }[] = [];
	const violations: string[] = [];
	const handlerErrors: string[] = [];
	let scenario: Scenario = 'normal';
	let advertiseS256 = true;
	let expectedCallback = '';
	let discoveryRequests = 0;
	let tokenRequests = 0;
	let origin = '';

	function reject(response: ServerResponse, reason: string) {
		violations.push(reason);
		json(response, 400, { error: 'invalid_request' });
	}

	async function handle(request: IncomingMessage, response: ServerResponse) {
		const url = new URL(request.url ?? '/', origin);
		if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
			discoveryRequests++;
			if (scenario === 'discovery-outage') return json(response, 503, { error: 'unavailable' });
			let issuer = origin;
			if (scenario === 'discovery-issuer') {
				issuer = `${origin}/foreign`;
			}
			let codeChallengeMethods: string[] | undefined;
			if (advertiseS256) {
				codeChallengeMethods = ['S256'];
			}
			return json(response, 200, {
				issuer,
				authorization_endpoint: `${origin}/authorize`,
				token_endpoint: `${origin}/token`,
				userinfo_endpoint: `${origin}/userinfo`,
				jwks_uri: `${origin}/jwks`,
				response_types_supported: ['code'],
				subject_types_supported: ['public'],
				id_token_signing_alg_values_supported: ['RS256'],
				token_endpoint_auth_methods_supported: ['client_secret_basic'],
				code_challenge_methods_supported: codeChallengeMethods
			});
		}
		if (request.method === 'GET' && url.pathname === '/jwks') {
			return json(response, 200, { keys: [jwk] });
		}
		if (request.method === 'GET' && url.pathname === '/authorize') {
			const params = url.searchParams;
			if (
				params.get('client_id') !== clientId ||
				params.get('redirect_uri') !== expectedCallback ||
				params.get('response_type') !== 'code' ||
				!params.get('scope')?.split(' ').includes('openid') ||
				params.get('code_challenge_method') !== 'S256' ||
				!params.get('state') ||
				!params.get('nonce') ||
				!params.get('code_challenge')
			) {
				return reject(response, 'Authorization lacks pinned client/callback or PKCE/state/nonce');
			}
			const authorization: Authorization = {
				code: randomBytes(24).toString('base64url'),
				state: params.get('state')!,
				nonce: params.get('nonce')!,
				challenge: params.get('code_challenge')!,
				redirectUri: expectedCallback,
				used: false,
				scenario
			};
			authorizations.push(authorization);
			const callback = new URL(authorization.redirectUri);
			callback.searchParams.set('code', authorization.code);
			callback.searchParams.set(
				'state',
				scenario === 'bad-state' ? 'foreign-state' : authorization.state
			);
			response.writeHead(302, { location: callback.href, 'cache-control': 'no-store' });
			response.end();
			return;
		}
		if (request.method === 'POST' && url.pathname === '/token') {
			tokenRequests++;
			const params = await body(request);
			const authorization = authorizations.find((entry) => entry.code === params.get('code'));
			const verifier = params.get('code_verifier') ?? '';
			// OAuth Basic credentials use form encoding (including ! and spaces), not URI encoding.
			const encodedCredentials = [clientId, clientSecret]
				.map((value) => new URLSearchParams({ value }).toString().slice('value='.length))
				.join(':');
			const basic = `Basic ${Buffer.from(encodedCredentials).toString('base64')}`;
			if (
				request.headers.authorization !== basic ||
				params.get('grant_type') !== 'authorization_code' ||
				!authorization ||
				authorization.used ||
				params.get('redirect_uri') !== authorization.redirectUri ||
				!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
				createHash('sha256').update(verifier).digest('base64url') !== authorization.challenge
			) {
				return reject(
					response,
					'Token request failed credentials, single-use code or S256 verifier'
				);
			}
			authorization.used = true;
			grants.push({ code: authorization.code, verifier });
			if (authorization.scenario === 'token-outage') {
				return json(response, 503, { error: 'unavailable' });
			}
			const now = Math.floor(Date.now() / 1000);
			let issuer = origin;
			if (authorization.scenario === 'bad-issuer') {
				issuer = `${origin}/foreign`;
			}
			let audience = clientId;
			if (authorization.scenario === 'bad-audience') {
				audience = 'foreign-client';
			}
			let expiresAt = now + 300;
			if (authorization.scenario === 'expired-token') {
				expiresAt = now - 3_600;
			}
			let nonce = authorization.nonce;
			if (authorization.scenario === 'bad-nonce') {
				nonce = 'foreign-nonce';
			}
			const claims = {
				iss: issuer,
				aud: audience,
				sub: 'c6-household',
				iat: now,
				exp: expiresAt,
				nonce,
				name: 'PRIVATE_C6_IDENTITY',
				email: 'private-c6@example.test'
			};
			const unsigned = [{ alg: 'RS256', typ: 'JWT', kid: jwk.kid }, claims]
				.map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
				.join('.');
			const idToken =
				authorization.scenario === 'malformed-token'
					? 'PRIVATE_C6_MALFORMED_ID_TOKEN'
					: `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
			tokens.push(idToken);
			return json(response, 200, {
				access_token: randomBytes(24).toString('base64url'),
				token_type: 'Bearer',
				expires_in: 300,
				id_token: idToken
			});
		}
		if (request.method === 'GET' && url.pathname === '/userinfo') {
			return json(response, 200, { sub: 'c6-household', name: 'PRIVATE_C6_IDENTITY' });
		}
		json(response, 404, { error: 'not_found' });
	}

	const server = createServer((request, response) => {
		void handle(request, response).catch(() => {
			handlerErrors.push('Fixture HTTP handler failed');
			if (!response.headersSent) json(response, 500, { error: 'fixture_failure' });
			else response.destroy();
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('No issuer TCP port');
	origin = `http://127.0.0.1:${address.port}`;

	return {
		origin,
		authorizations,
		grants,
		tokens,
		violations,
		handlerErrors,
		discoveryRequests: () => discoveryRequests,
		tokenRequests: () => tokenRequests,
		allowCallback(appOrigin: string) {
			expectedCallback = `${appOrigin}/auth/callback/oidc`;
		},
		scenario(value: Scenario) {
			scenario = value;
		},
		advertiseS256(value: boolean) {
			advertiseS256 = value;
		},
		async stop() {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			});
		}
	};
}

export type TestIssuer = Awaited<ReturnType<typeof startIssuer>>;
