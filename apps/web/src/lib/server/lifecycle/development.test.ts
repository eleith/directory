import { validateConfig } from '@directory/config';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Directory } from '../config/load-directory.js';
import { prepareSnapshot } from '../config/snapshot.js';
import type { Application, ServerState } from './application.js';

const mocks = vi.hoisted(() => ({
	boot: vi.fn<typeof import('../boot.js').bootApp>()
}));
vi.mock('../boot.js', () => ({ bootApp: mocks.boot }));

function application(title: string) {
	return {
		directory: {
			currentSnapshot: vi
				.fn()
				.mockReturnValue(
					prepareSnapshot(validateConfig({ site: { title }, links: {} }, { env: {} }))
				),
			reload: vi.fn<Directory['reload']>(),
			stop: vi.fn<Directory['stop']>()
		},
		publicDir: '/mounted/public',
		authentication: undefined,
		stop: vi.fn<Application['stop']>()
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
		if (name === 'directory:dev-stop') process.off(name, listener);
	}
	vi.restoreAllMocks();
});

function devStopListener(attempt = 0) {
	return listeners.mock.calls.filter(([name]) => name === 'directory:dev-stop')[attempt]![1];
}

describe('development lifecycle', () => {
	it('stops exactly once on the dev close event and unregisters its callback', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { application: undefined };
		const ready = application('Development');
		mocks.boot.mockResolvedValueOnce(ready);
		const off = vi.spyOn(process, 'off');
		await startDevelopment(server);
		expect(mocks.boot).toHaveBeenCalledExactlyOnceWith(undefined, undefined);
		expect(server.application).toBe(ready);
		expect(listeners.mock.calls.filter(([name]) => name === 'sveltekit:shutdown')).toEqual([]);
		const shutdown = devStopListener();
		expect(process.listenerCount('directory:dev-stop', shutdown)).toBe(1);
		process.emit('directory:dev-stop');
		process.emit('directory:dev-stop');
		shutdown();
		expect(ready.stop).toHaveBeenCalledOnce();
		expect(server.application).toBeUndefined();
		expect(process.listenerCount('directory:dev-stop', shutdown)).toBe(0);
		expect(
			off.mock.calls.filter(
				([name, listener]) => name === 'directory:dev-stop' && listener === shutdown
			)
		).toHaveLength(1);
	});

	it('cleans up a cached initialization before booting its replacement', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { application: undefined };
		const first = application('First');
		const second = application('Second');
		mocks.boot.mockResolvedValueOnce(first);
		await startDevelopment(server);
		const oldCleanup = devStopListener();
		mocks.boot.mockImplementationOnce(async () => {
			expect(first.stop).toHaveBeenCalledOnce();
			expect(server.application).toBeUndefined();
			expect(process.listenerCount('directory:dev-stop', oldCleanup)).toBe(0);
			return second;
		});
		await startDevelopment(server);
		oldCleanup();
		expect(server.application).toBe(second);
		expect(second.stop).not.toHaveBeenCalled();
		process.emit('directory:dev-stop');
		expect(first.stop).toHaveBeenCalledOnce();
		expect(second.stop).toHaveBeenCalledOnce();
	});

	it('reaches an older module instance during reimport before booting a new hooks state', async () => {
		const previous = await import('./development.js');
		const oldServer: ServerState = { application: undefined };
		const first = application('Old module');
		const second = application('New module');
		mocks.boot.mockResolvedValueOnce(first);
		await previous.startDevelopment(oldServer);
		const oldCleanup = devStopListener();
		vi.resetModules();
		const current = await import('./development.js');
		expect(current.startDevelopment).not.toBe(previous.startDevelopment);
		const server: ServerState = { application: undefined };
		mocks.boot.mockImplementationOnce(async () => {
			expect(first.stop).toHaveBeenCalledOnce();
			expect(oldServer.application).toBeUndefined();
			expect(process.listenerCount('directory:dev-stop', oldCleanup)).toBe(0);
			return second;
		});
		await current.startDevelopment(server);
		oldCleanup();
		expect(server.application).toBe(second);
		process.emit('directory:dev-stop');
		expect(second.stop).toHaveBeenCalledOnce();
		expect(server.application).toBeUndefined();
	});

	it('stops an application that finishes boot after dev server close without publishing it', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { application: undefined };
		const pending = Promise.withResolvers<Application>();
		const stopped = application('Never published');
		mocks.boot.mockReturnValueOnce(pending.promise);
		const startup = startDevelopment(server);
		expect(server.application).toBeUndefined();
		const shutdown = devStopListener();
		process.emit('directory:dev-stop');
		expect(process.listenerCount('directory:dev-stop', shutdown)).toBe(0);
		pending.resolve(stopped);
		await startup;
		shutdown();
		expect(stopped.stop).toHaveBeenCalledOnce();
		expect(stopped.directory.currentSnapshot).not.toHaveBeenCalled();
		expect(server.application).toBeUndefined();
	});

	it('cannot publish a superseded pending boot over a newer cached initialization', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { application: undefined };
		const pending = Promise.withResolvers<Application>();
		const first = application('Superseded');
		const second = application('Current');
		mocks.boot.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(second);
		const startup = startDevelopment(server);
		const oldCleanup = devStopListener();
		await startDevelopment(server);
		pending.resolve(first);
		await startup;
		oldCleanup();
		expect(first.stop).toHaveBeenCalledOnce();
		expect(second.stop).not.toHaveBeenCalled();
		expect(server.application).toBe(second);
		expect(server.application?.directory.currentSnapshot().display.site.title).toBe('Current');
		process.emit('directory:dev-stop');
		expect(second.stop).toHaveBeenCalledOnce();
	});

	it('removes its listener on boot failure and passes the error to the hook boundary', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { application: undefined };
		const error = new Error('private startup failure');
		mocks.boot.mockRejectedValueOnce(error);
		await expect(startDevelopment(server)).rejects.toBe(error);
		expect(server.application).toBeUndefined();
		expect(process.listenerCount('directory:dev-stop', devStopListener())).toBe(0);
	});

	it('leaves no leaked listener or cleared new state when a superseded boot fails', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { application: undefined };
		const pending = Promise.withResolvers<Application>();
		const current = application('Current');
		mocks.boot.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(current);
		const startup = startDevelopment(server);
		const failedCleanup = devStopListener();
		await startDevelopment(server);
		const failure = new Error('old boot failure');
		const rejection = expect(startup).rejects.toBe(failure);
		pending.reject(failure);
		await rejection;
		failedCleanup();
		expect(process.listenerCount('directory:dev-stop', failedCleanup)).toBe(0);
		expect(process.listenerCount('directory:dev-stop', devStopListener(1))).toBe(1);
		expect(server.application).toBe(current);
		expect(current.stop).not.toHaveBeenCalled();
		process.emit('directory:dev-stop');
		expect(current.stop).toHaveBeenCalledOnce();
	});

	it('ignores an old callback even when the new attempt has the same application identity', async () => {
		const { startDevelopment } = await import('./development.js');
		const server: ServerState = { application: undefined };
		const reused = application('Same identity');
		mocks.boot.mockResolvedValue(reused);
		await startDevelopment(server);
		const oldCleanup = devStopListener();
		await startDevelopment(server);
		expect(reused.stop).toHaveBeenCalledOnce();
		oldCleanup();
		expect(server.application).toBe(reused);
		expect(reused.stop).toHaveBeenCalledOnce();
		process.emit('directory:dev-stop');
		expect(server.application).toBeUndefined();
		expect(reused.stop).toHaveBeenCalledTimes(2);
	});
});
