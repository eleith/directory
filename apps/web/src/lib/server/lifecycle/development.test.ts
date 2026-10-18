import { validateConfig } from '@where/config';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Directory } from '../config/load-directory.js';
import { prepareSnapshot } from '../config/snapshot.js';
import type { ServerState } from './application.js';

const mocks = vi.hoisted(() => ({
	boot: vi.fn<typeof import('../boot.js').bootApp>()
}));
vi.mock('../boot.js', () => ({ bootApp: mocks.boot }));

function directory(title: string) {
	return {
		currentSnapshot: vi
			.fn()
			.mockReturnValue(
				prepareSnapshot(validateConfig({ site: { title }, links: {} }, { env: {} }))
			),
		reload: vi.fn<Directory['reload']>(),
		stop: vi.fn<Directory['stop']>()
	};
}

let listeners: MockInstance<typeof process.once>;
beforeEach(() => {
	vi.resetModules();
	mocks.boot.mockReset();
	listeners = vi.spyOn(process, 'once');
});

afterEach(() => {
	for (const [name, listener] of listeners.mock.calls) {
		if (name === 'where:dev-stop') process.off(name, listener);
	}
	vi.restoreAllMocks();
});

function devStopListener(attempt = 0) {
	return listeners.mock.calls.filter(([name]) => name === 'where:dev-stop')[attempt]![1];
}

describe('development lifecycle', () => {
	it('stops exactly once on the dev close event and unregisters its callback', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { directory: undefined };
		const ready = directory('Development');
		mocks.boot.mockResolvedValueOnce(ready);
		const off = vi.spyOn(process, 'off');
		await startDevelopment(server);
		expect(mocks.boot).toHaveBeenCalledExactlyOnceWith();
		expect(server.directory).toBe(ready);
		expect(listeners.mock.calls.filter(([name]) => name === 'sveltekit:shutdown')).toEqual([]);
		const shutdown = devStopListener();
		expect(process.listenerCount('where:dev-stop', shutdown)).toBe(1);
		process.emit('where:dev-stop');
		process.emit('where:dev-stop');
		shutdown();
		expect(ready.stop).toHaveBeenCalledOnce();
		expect(server.directory).toBeUndefined();
		expect(process.listenerCount('where:dev-stop', shutdown)).toBe(0);
		expect(
			off.mock.calls.filter(
				([name, listener]) => name === 'where:dev-stop' && listener === shutdown
			)
		).toHaveLength(1);
	});

	it('cleans up a cached initialization before booting its replacement', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { directory: undefined };
		const first = directory('First');
		const second = directory('Second');
		mocks.boot.mockResolvedValueOnce(first);
		await startDevelopment(server);
		const oldCleanup = devStopListener();
		mocks.boot.mockImplementationOnce(async () => {
			expect(first.stop).toHaveBeenCalledOnce();
			expect(server.directory).toBeUndefined();
			expect(process.listenerCount('where:dev-stop', oldCleanup)).toBe(0);
			return second;
		});
		await startDevelopment(server);
		oldCleanup();
		expect(server.directory).toBe(second);
		expect(second.stop).not.toHaveBeenCalled();
		process.emit('where:dev-stop');
		expect(first.stop).toHaveBeenCalledOnce();
		expect(second.stop).toHaveBeenCalledOnce();
	});

	it('reaches an older module instance during reimport before booting a new hooks state', async () => {
		const previous = await import('./development.js');
		const oldServer: ServerState = { directory: undefined };
		const first = directory('Old module');
		const second = directory('New module');
		mocks.boot.mockResolvedValueOnce(first);
		await previous.startDevelopment(oldServer);
		const oldCleanup = devStopListener();
		vi.resetModules();
		const current = await import('./development.js');
		expect(current.startDevelopment).not.toBe(previous.startDevelopment);
		const server: ServerState = { directory: undefined };
		mocks.boot.mockImplementationOnce(async () => {
			expect(first.stop).toHaveBeenCalledOnce();
			expect(oldServer.directory).toBeUndefined();
			expect(process.listenerCount('where:dev-stop', oldCleanup)).toBe(0);
			return second;
		});
		await current.startDevelopment(server);
		oldCleanup();
		expect(server.directory).toBe(second);
		process.emit('where:dev-stop');
		expect(second.stop).toHaveBeenCalledOnce();
		expect(server.directory).toBeUndefined();
	});

	it('stops a directory that finishes boot after dev server close without publishing it', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { directory: undefined };
		const pending = Promise.withResolvers<Directory>();
		const stopped = directory('Never published');
		mocks.boot.mockReturnValueOnce(pending.promise);
		const startup = startDevelopment(server);
		expect(server.directory).toBeUndefined();
		const shutdown = devStopListener();
		process.emit('where:dev-stop');
		expect(process.listenerCount('where:dev-stop', shutdown)).toBe(0);
		pending.resolve(stopped);
		await startup;
		shutdown();
		expect(stopped.stop).toHaveBeenCalledOnce();
		expect(stopped.currentSnapshot).not.toHaveBeenCalled();
		expect(server.directory).toBeUndefined();
	});

	it('cannot publish a superseded pending boot over a newer cached initialization', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { directory: undefined };
		const pending = Promise.withResolvers<Directory>();
		const first = directory('Superseded');
		const second = directory('Current');
		mocks.boot.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(second);
		const startup = startDevelopment(server);
		const oldCleanup = devStopListener();
		await startDevelopment(server);
		pending.resolve(first);
		await startup;
		oldCleanup();
		expect(first.stop).toHaveBeenCalledOnce();
		expect(second.stop).not.toHaveBeenCalled();
		expect(server.directory).toBe(second);
		expect(server.directory?.currentSnapshot().display.site.title).toBe('Current');
		process.emit('where:dev-stop');
		expect(second.stop).toHaveBeenCalledOnce();
	});

	it('removes its listener on boot failure and passes the error to the hook boundary', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { directory: undefined };
		const error = new Error('private startup failure');
		mocks.boot.mockRejectedValueOnce(error);
		await expect(startDevelopment(server)).rejects.toBe(error);
		expect(server.directory).toBeUndefined();
		expect(process.listenerCount('where:dev-stop', devStopListener())).toBe(0);
	});

	it('leaves no leaked listener or cleared new state when a superseded boot fails', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { directory: undefined };
		const pending = Promise.withResolvers<Directory>();
		const current = directory('Current');
		mocks.boot.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(current);
		const startup = startDevelopment(server);
		const failedCleanup = devStopListener();
		await startDevelopment(server);
		const failure = new Error('old boot failure');
		const rejection = expect(startup).rejects.toBe(failure);
		pending.reject(failure);
		await rejection;
		failedCleanup();
		expect(process.listenerCount('where:dev-stop', failedCleanup)).toBe(0);
		expect(process.listenerCount('where:dev-stop', devStopListener(1))).toBe(1);
		expect(server.directory).toBe(current);
		expect(current.stop).not.toHaveBeenCalled();
		process.emit('where:dev-stop');
		expect(current.stop).toHaveBeenCalledOnce();
	});

	it('ignores an old callback even when the new attempt has the same directory identity', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { directory: undefined };
		const reused = directory('Same identity');
		mocks.boot.mockResolvedValue(reused);
		await startDevelopment(server);
		const oldCleanup = devStopListener();
		await startDevelopment(server);
		expect(reused.stop).toHaveBeenCalledOnce();
		oldCleanup();
		expect(server.directory).toBe(reused);
		expect(reused.stop).toHaveBeenCalledOnce();
		process.emit('where:dev-stop');
		expect(server.directory).toBeUndefined();
		expect(reused.stop).toHaveBeenCalledTimes(2);
	});
});
