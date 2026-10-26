import { prepareRuntimeEnvironment } from './lib/server/runtime-environment.js';
import { reportStartupFailure } from './lib/server/logger.js';

try {
	await prepareRuntimeEnvironment();
} catch (error) {
	reportStartupFailure(error);
	process.exit(1);
}

// adapter-node captures ORIGIN during import, before its Kit init hook runs.
const entry = '../index.js';
export const { server } = await import(entry);
