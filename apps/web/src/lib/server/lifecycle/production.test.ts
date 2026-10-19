import { validateConfig } from '@directory/config';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Directory } from '../config/load-directory.js';
import { prepareSnapshot } from '../config/snapshot.js';
import type { Application, ServerState } from './application.js';
import { startProduction } from './production.js';

const adapterEvents: NodeJS.EventEmitter = process;

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
		authentication: undefined,
		stop: vi.fn<Application['stop']>()
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
		const server: ServerState = { application: undefined };
		const ready = application('Production');
		mocks.boot.mockResolvedValueOnce(ready);
		await startProduction(server);
		expect(mocks.boot).toHaveBeenCalledExactlyOnceWith();
		expect(server.application).toBe(ready);
		expect(listeners.mock.calls.filter(([name]) => name === 'directory:dev-stop')).toEqual([]);
		const shutdown = listeners.mock.calls.find(([name]) => name === 'sveltekit:shutdown')![1];
		expect(process.listenerCount('sveltekit:shutdown', shutdown)).toBe(1);
		adapterEvents.emit('sveltekit:shutdown');
		adapterEvents.emit('sveltekit:shutdown');
		expect(ready.stop).toHaveBeenCalledOnce();
		expect(server.application).toBeUndefined();
		expect(process.listenerCount('sveltekit:shutdown', shutdown)).toBe(0);
	});

	it('waits for boot before publishing or registering adapter shutdown', async () => {
		const server: ServerState = { application: undefined };
		const pending = Promise.withResolvers<Application>();
		const ready = application('Ready');
		mocks.boot.mockReturnValueOnce(pending.promise);
		const startup = startProduction(server);
		expect(server.application).toBeUndefined();
		expect(listeners.mock.calls.filter(([name]) => name === 'sveltekit:shutdown')).toEqual([]);
		pending.resolve(ready);
		await startup;
		expect(server.application).toBe(ready);
		expect(ready.stop).not.toHaveBeenCalled();
		expect(ready.directory.currentSnapshot).not.toHaveBeenCalled();
		adapterEvents.emit('sveltekit:shutdown');
		expect(ready.stop).toHaveBeenCalledOnce();
	});

	it('leaves no state or listener when boot fails, passing the error to the hook boundary', async () => {
		const server: ServerState = { application: undefined };
		const error = new Error('private startup failure');
		mocks.boot.mockRejectedValueOnce(error);
		await expect(startProduction(server)).rejects.toBe(error);
		expect(server.application).toBeUndefined();
		expect(listeners.mock.calls.filter(([name]) => name === 'sveltekit:shutdown')).toEqual([]);
	});

	it('cleans up its own application without clearing a replacement reference', async () => {
		const server: ServerState = { application: undefined };
		const owned = application('Owned');
		const replacement = application('Replacement');
		mocks.boot.mockResolvedValueOnce(owned);
		await startProduction(server);
		server.application = replacement;
		adapterEvents.emit('sveltekit:shutdown');
		expect(owned.stop).toHaveBeenCalledOnce();
		expect(replacement.stop).not.toHaveBeenCalled();
		expect(server.application).toBe(replacement);
	});
});
