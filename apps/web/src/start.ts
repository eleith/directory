import {
	installRequestOrigin,
	prepareAdapterEnvironment,
	prepareRuntimeEnvironment
} from './lib/server/runtime-environment.js';
import { reportStartupFailure } from './lib/server/logger.js';

const runtime = await prepareRuntimeEnvironment().catch((error: unknown) => {
	reportStartupFailure(error);
	process.exit(1);
});
prepareAdapterEnvironment();

const entry = '../index.js';
export const { server } = await import(entry);
// Adapter initialization finishes before listening; install before the next request turn.
installRequestOrigin(server, runtime.origin);
