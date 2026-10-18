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
		}
	}
}

export {};
