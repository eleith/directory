import type { Session } from '@auth/sveltekit';
import type { Authentication } from './lib/server/auth/index.js';
import type { PreparedSnapshot } from './lib/server/config/snapshot.js';

declare global {
	namespace NodeJS {
		interface Process {
			emit(event: 'directory:dev-stop'): boolean;
		}
	}

	namespace App {
		interface Locals {
			snapshot: PreparedSnapshot;
			authentication: Authentication | undefined;
			session: Session | null;
		}
	}
}

export {};
