import { watchFile, unwatchFile, type Stats } from 'node:fs';
import { logger } from '../logger.js';

export function watchConfig(path: string, onChange: () => Promise<void>): () => void {
	let stopped = false;
	async function listener(current: Stats, previous: Stats): Promise<void> {
		if (
			stopped ||
			(current.ino === previous.ino &&
				current.mtimeMs === previous.mtimeMs &&
				current.size === previous.size)
		) {
			return;
		}
		try {
			await onChange();
		} catch {
			if (!stopped) logger.error('Configuration reload callback failed.');
		}
	}

	// Poll the path so atomic saves and deletion/recreation do not detach the watcher.
	watchFile(path, { interval: 1000, persistent: false }, listener);
	return () => {
		if (stopped) return;
		stopped = true;
		unwatchFile(path, listener);
	};
}
