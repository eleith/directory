import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ConfigError, loadConfigFile, resolveConfigPath, type ConfigIssue } from '@where/config';
import type { ConfigLoadOptions } from '@where/config/types';
import { prepareSnapshot, type PreparedSnapshot } from './snapshot.js';

export interface DirectoryIssue {
	readonly code:
		| 'load_failed'
		| 'prepare_failed'
		| 'restart_required'
		| 'auth_unavailable'
		| 'watch_failed';
	readonly issues?: readonly ConfigIssue[];
}

export class DirectoryError extends Error {
	readonly issue: DirectoryIssue;

	constructor(issue: DirectoryIssue) {
		super(`Directory startup failed (${issue.code}).`);
		this.name = 'DirectoryError';
		this.issue = Object.freeze({ ...issue });
	}
}

export interface LoadDirectoryOptions extends ConfigLoadOptions {
	/** Called synchronously with safe diagnostics for rejected reloads. */
	report?: (issue: DirectoryIssue) => void;
}

export interface Directory {
	currentSnapshot(): PreparedSnapshot;
	reload(): Promise<void>;
	/** Stops future work and publication without cancelling in-flight I/O. */
	stop(): void;
}

interface DirectoryState {
	currentSnapshot: PreparedSnapshot;
	readonly bootAuth: PreparedSnapshot['configuration']['auth'];
	readonly path: string;
	readonly loadOptions: ConfigLoadOptions;
	readonly report: LoadDirectoryOptions['report'];
	hasPendingReload: boolean;
	activeRunPromise: Promise<void> | undefined;
	stopped: boolean;
}

export async function loadDirectory(
	path?: string,
	options: LoadDirectoryOptions = {}
): Promise<Directory> {
	const loadOptions: ConfigLoadOptions = options.env === undefined ? {} : { env: options.env };
	let configPath: string;
	let initial: PreparedSnapshot;
	let code: DirectoryIssue['code'] = 'load_failed';
	try {
		configPath = path === undefined ? resolveConfigPath(loadOptions) : resolve(path);
		const config = await loadConfigFile(configPath, loadOptions);
		code = 'prepare_failed';
		initial = await prepareSnapshot(config);
	} catch (error) {
		throw new DirectoryError(safeIssue(code, error));
	}

	const state: DirectoryState = {
		currentSnapshot: initial,
		// The initial prepared configuration is already an owned, deeply frozen copy.
		bootAuth: initial.configuration.auth,
		path: configPath,
		loadOptions,
		report: options.report,
		hasPendingReload: false,
		activeRunPromise: undefined,
		stopped: false
	};
	return {
		currentSnapshot: () => state.currentSnapshot,
		reload() {
			if (state.stopped) return Promise.resolve();
			state.hasPendingReload = true;
			// Defer the run until its promise has been recorded.
			state.activeRunPromise ??= Promise.resolve().then(() => runPendingReloads(state));
			return state.activeRunPromise;
		},
		stop() {
			state.stopped = true;
			state.hasPendingReload = false;
		}
	};
}

async function runPendingReloads(state: DirectoryState): Promise<void> {
	try {
		while (!state.stopped && state.hasPendingReload) {
			state.hasPendingReload = false;
			await reloadSnapshot(state);
		}
	} finally {
		state.activeRunPromise = undefined;
	}
}

async function reloadSnapshot(state: DirectoryState): Promise<void> {
	let code: DirectoryIssue['code'] = 'load_failed';
	try {
		const config = await loadConfigFile(state.path, state.loadOptions);
		if (state.stopped) return;
		if (!isDeepStrictEqual(config.auth, state.bootAuth)) {
			reportIssue(state, Object.freeze({ code: 'restart_required' }));
			return;
		}
		code = 'prepare_failed';
		const snapshot = await prepareSnapshot(config);
		if (state.stopped) return;
		state.currentSnapshot = snapshot;
	} catch (error) {
		if (!state.stopped) reportIssue(state, safeIssue(code, error));
	}
}

function safeIssue(code: DirectoryIssue['code'], error: unknown): DirectoryIssue {
	if (code === 'load_failed' && error instanceof ConfigError) {
		return Object.freeze({ code, issues: error.issues });
	}
	return Object.freeze({ code });
}

function reportIssue(state: DirectoryState, issue: DirectoryIssue): void {
	if (state.stopped) return;
	try {
		state.report?.(issue);
	} catch {
		// A synchronous diagnostic failure must not poison subsequent reloads.
	}
}
