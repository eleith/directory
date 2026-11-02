import { createHash, timingSafeEqual } from 'node:crypto';
import type { DirectoryCredentialsAuth } from '@directory/config/types';

export function verifyCredentials(
	configured: DirectoryCredentialsAuth,
	submitted: unknown
): { id: string; name: string } | null {
	if (typeof submitted !== 'object' || submitted === null) return null;
	const fields = submitted as Record<string, unknown>;
	const username = typeof fields.username === 'string' ? fields.username : '';
	const password = typeof fields.password === 'string' ? fields.password : '';
	// Fixed-size digests allow both comparisons even when input lengths differ.
	const usernameMatches = secretEquals(username, configured.username);
	const passwordMatches = secretEquals(password, configured.password);
	return usernameMatches && passwordMatches ? { id: 'directory', name: 'Directory' } : null;
}

function secretEquals(left: string, right: string): boolean {
	return timingSafeEqual(digest(left), digest(right));
}

function digest(value: string): Buffer {
	return createHash('sha256').update(value).digest();
}
