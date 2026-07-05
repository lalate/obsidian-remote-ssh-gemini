import { describe, it, expect, beforeEach, vi } from 'vitest';

const importDesktop = vi.fn(async () => ({
  default: class {
    setVaultLogger() {}
    async onload() {}
    onunload() {}
  },
}));

const importMobile = vi.fn(async () => ({
  default: class {
    setVaultLogger() {}
    async onload() {}
    onunload() {}
  },
}));

vi.mock('../src/main.desktop', () => importDesktop());
vi.mock('../src/main.mobile', () => importMobile());

import { App, Platform } from 'obsidian';

function makeApp(): App {
  const app = new App();
  const vault = app.vault as unknown as {
    getAbstractFileByPath: (path: string) => null;
    create: (path: string, data: string) => Promise<{ path: string }>;
    append: (file: unknown, data: string) => Promise<void>;
    read: (file: unknown) => Promise<string>;
    modify: (file: unknown, data: string) => Promise<void>;
  };
  vault.getAbstractFileByPath = () => null;
  vault.create = async (path) => ({ path });
  vault.append = async () => {};
  vault.read = async () => '';
  vault.modify = async () => {};
  return app;
}

describe('main dispatcher', () => {
  beforeEach(() => {
    importDesktop.mockClear();
    importMobile.mockClear();
  });

  it('loads desktop delegate when not mobile', async () => {
    Platform.isMobileApp = false;
    const { default: RemoteSshPlugin } = await import('../src/main');
    const plugin = new RemoteSshPlugin(makeApp() as never, {
      id: 'remote-ssh',
      name: 'Remote SSH',
      version: '0.0.0-test',
      minAppVersion: '1.0.0',
      description: '',
      author: '',
      isDesktopOnly: false,
    } as never);
    await plugin.onload();

    expect(importDesktop).toHaveBeenCalledTimes(1);
    expect(importMobile).toHaveBeenCalledTimes(0);
  });

  it('loads mobile delegate on mobile', async () => {
    Platform.isMobileApp = true;
    const { default: RemoteSshPlugin } = await import('../src/main');
    const plugin = new RemoteSshPlugin(makeApp() as never, {
      id: 'remote-ssh',
      name: 'Remote SSH',
      version: '0.0.0-test',
      minAppVersion: '1.0.0',
      description: '',
      author: '',
      isDesktopOnly: false,
    } as never);
    await plugin.onload();

    expect(importMobile).toHaveBeenCalledTimes(1);
    expect(importDesktop).toHaveBeenCalledTimes(0);
  });
});
