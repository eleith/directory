import type { Stats } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startConfigReloading } from './index.js';

type Listener = (current: Stats, previous: Stats) => Promise<void>;
const mocks = vi.hoisted(() => ({
	watchFile: vi.fn<(path: string, options: object, listener: Listener) => void>(),
	unwatchFile: vi.fn()
}));
vi.mock('node:fs', () => mocks);

const path = '/config/settings.json';
function options() {
	return {
		path,
		initial: 'initial',
		load: vi.fn<(path: string) => Promise<string>>().mockResolvedValue('reconciled'),
		onChange: vi.fn<(next: string, previous: string) => boolean>().mockReturnValue(true),
		onError: vi.fn<(error: unknown) => void>()
	};
}

function metadata(values: Partial<Stats> = {}): Stats {
	return { ino: 10, mtimeMs: 100, ctimeMs: 100, size: 50, ...values } as Stats;
}
function listener(index = 0): Listener {
	return mocks.watchFile.mock.calls[index]![2];
}
function change(index = 0): Promise<void> {
	return listener(index)(metadata({ ctimeMs: 101 }), metadata());
}

beforeEach(() => vi.resetAllMocks());

describe('startConfigReloading', () => {
	it('subscribes before reconciliation and waits for it, using initial as the baseline', async () => {
		const input = options();
		const read = Promise.withResolvers<string>();
		input.load.mockReturnValueOnce(read.promise);
		const ready = vi.fn();
		const startup = startConfigReloading(input).then((stop) => {
			ready();
			return stop;
		});
		expect(mocks.watchFile).toHaveBeenCalledExactlyOnceWith(
			path,
			{ interval: 1000, persistent: false },
			expect.any(Function)
		);
		// Work starts in a microtask, after the active promise has been assigned.
		expect(input.load).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(input.load).toHaveBeenCalledExactlyOnceWith(path);
		expect(ready).not.toHaveBeenCalled();
		expect(input.onChange).not.toHaveBeenCalled();
		read.resolve('saved during startup');
		const stop = await startup;
		expect(input.onChange).toHaveBeenCalledExactlyOnceWith('saved during startup', 'initial');
		stop();
	});

	it('ignores unchanged metadata and access-time-only changes', async () => {
		const input = options();
		const stop = await startConfigReloading(input);
		await listener()(metadata(), metadata());
		await listener()(metadata({ atimeMs: 200 }), metadata());
		expect(input.load).toHaveBeenCalledOnce();
		stop();
	});

	it.each([
		['inode', { ino: 11 }],
		['mtime', { mtimeMs: 101 }],
		['ctime with unchanged size and mtime', { ctimeMs: 101 }],
		['size', { size: 51 }]
	])('reloads for changed %s', async (_name, changed) => {
		const input = options();
		const stop = await startConfigReloading(input);
		await listener()(metadata(changed), metadata());
		expect(input.load).toHaveBeenCalledTimes(2);
		stop();
	});

	it('retains the last accepted value after rejection, callback throws and read failure, then recovers', async () => {
		const input = options();
		const stop = await startConfigReloading(input);
		input.load.mockResolvedValueOnce('rejected');
		input.onChange.mockReturnValueOnce(false);
		await change();
		expect(input.onError).not.toHaveBeenCalled();

		const callbackFailure = new Error('callback failed');
		input.load.mockResolvedValueOnce('throwing');
		input.onChange.mockImplementationOnce(() => {
			throw callbackFailure;
		});
		await change();
		const readFailure = new Error('read failed');
		input.load.mockRejectedValueOnce(readFailure);
		await change();
		input.load.mockResolvedValueOnce('recovered').mockResolvedValueOnce('latest');
		await change();
		await change();

		expect(input.onChange.mock.calls).toEqual([
			['reconciled', 'initial'],
			['rejected', 'reconciled'],
			['throwing', 'reconciled'],
			['recovered', 'reconciled'],
			['latest', 'recovered']
		]);
		expect(input.onError.mock.calls).toEqual([[callbackFailure], [readFailure]]);
		stop();
	});

	it('reports failed reconciliation without losing the initial baseline or future monitoring', async () => {
		const input = options();
		const failure = new Error('initial reconciliation failed');
		input.load.mockRejectedValueOnce(failure);
		const stop = await startConfigReloading(input);
		expect(input.onError).toHaveBeenCalledExactlyOnceWith(failure);
		expect(input.onChange).not.toHaveBeenCalled();
		await change();
		expect(input.onChange).toHaveBeenCalledExactlyOnceWith('reconciled', 'initial');
		stop();
	});

	it('serializes slow reads and coalesces events during reconciliation into one follow-up', async () => {
		const input = options();
		const first = Promise.withResolvers<string>();
		const second = Promise.withResolvers<string>();
		const readingAgain = Promise.withResolvers<void>();
		input.load.mockReturnValueOnce(first.promise).mockImplementationOnce(() => {
			readingAgain.resolve();
			return second.promise;
		});
		const ready = vi.fn();
		const startup = startConfigReloading(input).then((stop) => {
			ready();
			return stop;
		});
		await Promise.resolve();
		const active = change();
		for (let i = 0; i < 10; i++) void change();
		expect(input.load).toHaveBeenCalledOnce();
		first.resolve('first');
		await readingAgain.promise;
		expect(input.onChange).toHaveBeenCalledExactlyOnceWith('first', 'initial');
		expect(ready).not.toHaveBeenCalled();
		second.resolve('second');
		const stop = await startup;
		await active;
		expect(input.load).toHaveBeenCalledTimes(2);
		expect(input.onChange).toHaveBeenLastCalledWith('second', 'first');
		stop();
	});

	it('keeps monitoring after a throwing reporter', async () => {
		const input = options();
		const stop = await startConfigReloading(input);
		const failure = new Error('read failed');
		input.load.mockRejectedValueOnce(failure).mockResolvedValue('recovered');
		input.onError.mockImplementation(() => {
			throw new Error('diagnostic failure');
		});
		await change();
		await change();
		expect(input.load).toHaveBeenCalledTimes(3);
		expect(input.onError).toHaveBeenCalledExactlyOnceWith(failure);
		expect(input.onChange).toHaveBeenLastCalledWith('recovered', 'reconciled');
		stop();
	});

	it.each(['resolve', 'reject'])(
		'stops a pending read before its late %s and clears queued work',
		async (mode) => {
			const input = options();
			const stop = await startConfigReloading(input);
			const read = Promise.withResolvers<string>();
			input.load.mockReturnValueOnce(read.promise);
			const active = change();
			await Promise.resolve();
			expect(input.load).toHaveBeenCalledTimes(2);
			void change();
			stop();
			stop();
			expect(mocks.unwatchFile).toHaveBeenCalledExactlyOnceWith(path, listener());
			if (mode === 'resolve') read.resolve('too late');
			else read.reject(new Error('too late'));
			await active;
			await change();
			expect(input.load).toHaveBeenCalledTimes(2);
			expect(input.onChange).toHaveBeenCalledOnce();
			expect(input.onError).not.toHaveBeenCalled();
		}
	);

	it('stops scheduled work and removes only its own listener on a shared path', async () => {
		const first = options();
		const second = options();
		const stopFirst = await startConfigReloading(first);
		const stopSecond = await startConfigReloading(second);
		const scheduled = change(0);
		stopFirst();
		await scheduled;
		await change(0);
		await change(1);
		expect(first.load).toHaveBeenCalledOnce();
		expect(second.load).toHaveBeenCalledTimes(2);
		expect(listener(0)).not.toBe(listener(1));
		expect(mocks.unwatchFile).toHaveBeenCalledExactlyOnceWith(path, listener(0));
		stopSecond();
		expect(mocks.unwatchFile.mock.calls).toEqual([
			[path, listener(0)],
			[path, listener(1)]
		]);
	});

	it('propagates registration failure without starting a load', async () => {
		const input = options();
		const failure = new Error('watch registration failed');
		mocks.watchFile.mockImplementationOnce(() => {
			throw failure;
		});
		await expect(startConfigReloading(input)).rejects.toBe(failure);
		expect(input.load).not.toHaveBeenCalled();
		expect(input.onChange).not.toHaveBeenCalled();
		expect(input.onError).not.toHaveBeenCalled();
		expect(mocks.unwatchFile).not.toHaveBeenCalled();
	});
});
