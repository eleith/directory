import type { Session } from '@auth/sveltekit';
import type { DirectoryContent } from './lib/display/types.js';
import type { Authentication } from './lib/server/auth/index.js';
import type { PreparedSnapshot } from './lib/server/config/snapshot.js';

declare global {
	namespace NodeJS {
		interface Process {
			emit(event: 'directory:dev-stop'): boolean;
		}
	}

	namespace App {
		interface PageData {
			directory?: DirectoryContent;
		}

		interface PageState {
			directoryQuery?: string;
			directoryDetail?: { id: string; fromGrid: boolean } | null;
		}

		interface Locals {
			snapshot: PreparedSnapshot;
			publicDir: string;
			authentication: Authentication | undefined;
			session: Session | null;
		}
	}
}

export {};
