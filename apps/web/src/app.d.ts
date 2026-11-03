import type { DirectoryContent } from './lib/display/types.js';
import type { Authentication, DirectorySession } from './lib/server/auth/index.js';
import type { PreparedSnapshot } from './lib/server/directory/snapshot.js';

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
			directoryDetail?: { id: string; fromGrid: boolean } | null;
		}

		interface Locals {
			snapshot: PreparedSnapshot;
			publicDir: string;
			authentication: Authentication | undefined;
			session: DirectorySession | null;
			auth(): Promise<DirectorySession | null>;
		}
	}
}

export {};
