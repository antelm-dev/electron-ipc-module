import { vi } from 'vitest';
import { describe, it, expect } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {},
}));

import { createIpcContainer } from './ipc-container.js';
import type { IpcCleanup, IpcModuleRegister } from './ipc-module.js';

const fakeRegister =
  (channels: string[]): IpcModuleRegister =>
  async () => ({
    channels: channels.map(
      (ch) => [ch, vi.fn()] as const satisfies IpcCleanup,
    ),
  });

describe('createIpcContainer', () => {
  it('starts empty', () => {
    const container = createIpcContainer();
    expect(container.size).toBe(0);
    expect(container.names).toEqual([]);
    expect(container.allChannels).toEqual([]);
  });

  it('loads a module and tracks its channels', async () => {
    const container = createIpcContainer();
    const channels = await container.load(
      'auth',
      fakeRegister(['auth:login', 'auth:logout']),
    );

    expect(channels).toEqual(['auth:login', 'auth:logout']);
    expect(container.has('auth')).toBe(true);
    expect(container.getChannels('auth')).toEqual([
      'auth:login',
      'auth:logout',
    ]);
    expect(container.size).toBe(1);
    expect(container.names).toEqual(['auth']);
    expect(container.allChannels).toEqual([
      'auth:login',
      'auth:logout',
    ]);
  });

  it('loadAll loads multiple modules', async () => {
    const container = createIpcContainer();

    await container.loadAll({
      config: fakeRegister(['config:get']),
      theme: fakeRegister(['theme:set']),
    });

    expect(container.size).toBe(2);
    expect(container.names).toContain('config');
    expect(container.names).toContain('theme');
  });

  it('unload calls cleanup and removes the module', async () => {
    const channelCleanup = vi.fn();
    const moduleCleanup = vi.fn();
    const register: IpcModuleRegister = async () => ({
      channels: [['ch1', channelCleanup]],
      cleanup: moduleCleanup,
    });
    const container = createIpcContainer();

    await container.load('mod', register);
    const result = container.unload('mod');

    expect(result).toBe(true);
    expect(channelCleanup).toHaveBeenCalledOnce();
    expect(moduleCleanup).toHaveBeenCalledOnce();
    expect(container.has('mod')).toBe(false);
    expect(container.size).toBe(0);
  });

  it('unload returns false for unknown module', () => {
    const container = createIpcContainer();
    expect(container.unload('nope')).toBe(false);
  });

  it('unloadAll removes all modules', async () => {
    const container = createIpcContainer();
    await container.loadAll({
      a: fakeRegister(['a:1']),
      b: fakeRegister(['b:1']),
    });

    container.unloadAll();
    expect(container.size).toBe(0);
  });

  it('re-loading a module unloads the previous one first', async () => {
    const cleanup1 = vi.fn();
    const container = createIpcContainer();

    await container.load('mod', async () => ({
      channels: [['ch1', cleanup1]],
    }));
    await container.load('mod', fakeRegister(['ch2']));

    expect(cleanup1).toHaveBeenCalledOnce();
    expect(container.getChannels('mod')).toEqual(['ch2']);
  });

  it('emits loaded event', async () => {
    const spy = vi.fn();
    const container = createIpcContainer();
    container.on('loaded', spy);

    await container.load('test', fakeRegister(['test:ping']));

    expect(spy).toHaveBeenCalledWith('test', ['test:ping']);
  });

  it('emits unloaded event', async () => {
    const spy = vi.fn();
    const container = createIpcContainer();
    container.on('unloaded', spy);

    await container.load('test', fakeRegister(['test:ping']));
    container.unload('test');

    expect(spy).toHaveBeenCalledWith('test');
  });

  it('emits error event on register failure', async () => {
    const spy = vi.fn();
    const boom = new Error('register failed');
    const container = createIpcContainer();
    container.on('error', spy);

    await expect(
      container.load('broken', async () => {
        throw boom;
      }),
    ).rejects.toThrow(boom);

    expect(spy).toHaveBeenCalledWith('broken', boom);
  });

  it('getChannels returns empty array for unknown module', () => {
    const container = createIpcContainer();
    expect(container.getChannels('ghost')).toEqual([]);
  });
});
