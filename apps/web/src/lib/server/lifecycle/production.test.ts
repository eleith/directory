import { validateConfig } from '@directory/config';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Directory } from '../config/load-directory.js';
import { prepareSnapshot } from '../config/snapshot.js';
import type { ServerState } from './application.js';
import { startProduction } from './production.js';

const adapterEvents: NodeJS.EventEmitter = process;

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
	mocks.boot.mockReset();
	listeners = vi.spyOn(process, 'once');
});

afterEach(() => {
	for (const [name, listener] of listeners.mock.calls) {
		if (name === 'sveltekit:shutdown') process.off(name, listener);
	}
	vi.restoreAllMocks();
});

describe('production lifecycle', () => {
	it('publishes successful boot and stops exactly once on the adapter shutdown event', async () => {
		const server: ServerState = { directory: undefined };
		const ready = directory('Production');
		mocks.boot.mockResolvedValueOnce(ready);
		await startProduction(server);
		expect(mocks.boot).toHaveBeenCalledExactlyOnceWith();
		expect(server.directory).toBe(ready);
		expect(listeners.mock.calls.filter(([name]) => name === 'directory:dev-stop')).toEqual([]);
		const shutdown = listeners.mock.calls.find(([name]) => name === 'sveltekit:shutdown')![1];
		expect(process.listenerCount('sveltekit:shutdown', shutdown)).toBe(1);
		adapterEvents.emit('sveltekit:shutdown');
		adapterEvents.emit('sveltekit:shutdown');
		expect(ready.stop).toHaveBeenCalledOnce();
		expect(server.directory).toBeUndefined();
		expect(process.listenerCount('sveltekit:shutdown', shutdown)).toBe(0);
	});

	it('waits for boot before publishing or registering adapter shutdown', async () => {
		const server: ServerState = { directory: undefined };
		const pending = Promise.withResolvers<Directory>();
		const ready = directory('Ready');
		mocks.boot.mockReturnValueOnce(pending.promise);
		const startup = startProduction(server);
		expect(server.directory).toBeUndefined();
		expect(listeners.mock.calls.filter(([name]) => name === 'sveltekit:shutdown')).toEqual([]);
		pending.resolve(ready);
		await startup;
		expect(server.directory).toBe(ready);
		expect(ready.stop).not.toHaveBeenCalled();
		expect(ready.currentSnapshot).not.toHaveBeenCalled();
		adapterEvents.emit('sveltekit:shutdown');
		expect(ready.stop).toHaveBeenCalledOnce();
	});

	it('leaves no state or listener when boot fails, passing the error to the hook boundary', async () => {
		const server: ServerState = { directory: undefined };
		const error = new Error('private startup failure');
		mocks.boot.mockRejectedValueOnce(error);
		await expect(startProduction(server)).rejects.toBe(error);
		expect(server.directory).toBeUndefined();
		expect(listeners.mock.calls.filter(([name]) => name === 'sveltekit:shutdown')).toEqual([]);
	});

	it('cleans up its own directory without clearing a replacement reference', async () => {
		const server: ServerState = { directory: undefined };
		const owned = directory('Owned');
		const replacement = directory('Replacement');
		mocks.boot.mockResolvedValueOnce(owned);
		await startProduction(server);
		server.directory = replacement;
		adapterEvents.emit('sveltekit:shutdown');
		expect(owned.stop).toHaveBeenCalledOnce();
		expect(replacement.stop).not.toHaveBeenCalled();
		expect(server.directory).toBe(replacement);
	});
});
