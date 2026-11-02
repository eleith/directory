import { describe, expect, it } from 'vitest';
import { verifyCredentials } from './credentials.js';

const credentials = { username: 'family', password: 'correct café ☕' };

describe('configured shared credentials', () => {
	it('authorizes the configured shared credentials', () => {
		expect(verifyCredentials(credentials, credentials)).not.toBeNull();
	});

	it.each([
		undefined,
		null,
		{},
		{ username: 'someone-else', password: credentials.password },
		{ username: credentials.username, password: 'incorrect' },
		{ username: ['family'], password: credentials.password },
		{ username: credentials.username, password: { toString: () => credentials.password } },
		{ username: 'family ', password: credentials.password },
		{ username: credentials.username, password: `${credentials.password}\u0000` }
	])('rejects wrong or malformed credentials: %j', (submitted) => {
		expect(verifyCredentials(credentials, submitted)).toBeNull();
	});
});
