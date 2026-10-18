import type { Stats } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger.js';
import { watchConfig } from './watch.js';

type Listener = (current: Stats, previous: Stats) => Promise<void>;
const mocks = vi.hoisted(() => ({
	watchFile: vi.fn<(path: string, options: object, listener: Listener) => void>(),
	unwatchFile: vi.fn()
}));
vi.mock('node:fs', () => mocks);

function metadata(values: Partial<Stats> = {}): Stats {
	return { ino: 10, mtimeMs: 100, size: 50, ...values } as Stats;
}

function listener(index = 0): Listener {
	return mocks.watchFile.mock.calls[index]![2];
}

beforeEach(() => {
	vi.clearAllMocks();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('watchConfig', () => {
	it('registers one non-persistent one-second path poll without an initial reload', () => {
		const onChange = vi.fn<() => Promise<void>>();
		watchConfig('/config/where.yaml', onChange);
		expect(mocks.watchFile).toHaveBeenCalledExactlyOnceWith(
			'/config/where.yaml',
			{ interval: 1000, persistent: false },
			expect.any(Function)
		);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('ignores equal metadata and differences in unrelated stat fields', async () => {
		const onChange = vi.fn<() => Promise<void>>();
		watchConfig('/config/where.yaml', onChange);
		await listener()(metadata(), metadata());
		await listener()(metadata({ atimeMs: 200, ctimeMs: 300 }), metadata());
		expect(onChange).not.toHaveBeenCalled();
	});

	it.each([
		['inode (atomic replacement)', { ino: 11 }],
		['modification time', { mtimeMs: 101 }],
		['size', { size: 51 }]
	])('reloads when only %s changes', async (_name, changed) => {
		const onChange = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
		watchConfig('/config/where.yaml', onChange);
		await listener()(metadata(changed), metadata());
		expect(onChange).toHaveBeenCalledExactlyOnceWith();
	});

	it('reloads on deletion and recreation, even with the original metadata', async () => {
		const onChange = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
		watchConfig('/config/where.yaml', onChange);
		const missing = metadata({ ino: 0, mtimeMs: 0, size: 0 });
		await listener()(missing, metadata());
		await listener()(metadata(), missing);
		expect(onChange).toHaveBeenCalledTimes(2);
	});

	it('stops once, removes only its exact listener, and ignores stale events', async () => {
		const onChange = vi.fn<() => Promise<void>>();
		const stop = watchConfig('/config/where.yaml', onChange);
		const registered = listener();
		stop();
		stop();
		expect(mocks.unwatchFile).toHaveBeenCalledExactlyOnceWith('/config/where.yaml', registered);
		await registered(metadata({ ino: 11 }), metadata());
		expect(onChange).not.toHaveBeenCalled();
	});

	it('keeps registrations independent, including for the same path', async () => {
		const first = vi.fn<() => Promise<void>>();
		const second = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
		const stopFirst = watchConfig('/config/where.yaml', first);
		const stopSecond = watchConfig('/config/where.yaml', second);
		expect(listener(0)).not.toBe(listener(1));
		stopFirst();
		await listener(0)(metadata({ ino: 11 }), metadata());
		await listener(1)(metadata({ ino: 11 }), metadata());
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledOnce();
		stopSecond();
		expect(mocks.unwatchFile.mock.calls).toEqual([
			['/config/where.yaml', listener(0)],
			['/config/where.yaml', listener(1)]
		]);
	});

	it.each(['reject', 'throw'])(
		'contains an unexpected callback %s with a fixed diagnostic',
		async (mode) => {
			const error = vi.spyOn(logger, 'error').mockReturnValue(undefined);
			const sentinel = 'PRIVATE-password-file.yaml';
			const onChange = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
			if (mode === 'reject') onChange.mockRejectedValueOnce(new Error(sentinel));
			else
				onChange.mockImplementationOnce(() => {
					throw new Error(sentinel);
				});
			watchConfig('/config/where.yaml', onChange);
			await expect(listener()(metadata({ ino: 11 }), metadata())).resolves.toBeUndefined();
			expect(error).toHaveBeenCalledExactlyOnceWith('Configuration reload callback failed.');
			await listener()(metadata({ ino: 12 }), metadata({ ino: 11 }));
			expect(onChange).toHaveBeenCalledTimes(2);
			expect(error).toHaveBeenCalledOnce();
		}
	);

	it.each(['resolve', 'reject'])(
		'suppresses stale in-flight %s completion after stop',
		async (mode) => {
			const error = vi.spyOn(logger, 'error').mockReturnValue(undefined);
			const pending = Promise.withResolvers<void>();
			const onChange = vi.fn<() => Promise<void>>().mockReturnValue(pending.promise);
			const stop = watchConfig('/config/where.yaml', onChange);
			const active = listener()(metadata({ ino: 11 }), metadata());
			expect(onChange).toHaveBeenCalledOnce();
			stop();
			if (mode === 'resolve') pending.resolve();
			else pending.reject(new Error('PRIVATE-password-file.yaml'));
			await expect(active).resolves.toBeUndefined();
			await listener()(metadata({ ino: 12 }), metadata({ ino: 11 }));
			expect(onChange).toHaveBeenCalledOnce();
			expect(error).not.toHaveBeenCalled();
		}
	);
});
