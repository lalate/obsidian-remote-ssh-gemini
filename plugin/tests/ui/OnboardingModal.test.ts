import { describe, it, expect, beforeEach } from 'vitest';
import { OnboardingModal, type OnboardingFinishCallback } from '../../src/ui/OnboardingModal';
import { App, clearNotices, recordedNotices } from 'obsidian';
import type { AuthResolver } from '../../src/ssh/AuthResolver';
import type { HostKeyStore } from '../../src/ssh/HostKeyStore';

// Stub auth deps — never connected, just exist for the modal.
const authResolver = {} as AuthResolver;
const hostKeyStore = {} as HostKeyStore;
const deps = { authResolver, hostKeyStore };

interface FinishCall {
  profile?: { host: string; username: string; remotePath: string; name: string };
  dismissOnboarding: boolean;
}

function recordingFinish(): { calls: FinishCall[]; cb: OnboardingFinishCallback } {
  const calls: FinishCall[] = [];
  const cb: OnboardingFinishCallback = async (opts) => {
    calls.push({
      profile: opts.profile && {
        host: opts.profile.host,
        username: opts.profile.username,
        remotePath: opts.profile.remotePath,
        name: opts.profile.name,
      },
      dismissOnboarding: opts.dismissOnboarding,
    });
  };
  return { calls, cb };
}

describe('OnboardingModal', () => {
  beforeEach(() => clearNotices());

  describe('initial render', () => {
    it('renders the wizard heading + intro paragraph on open', () => {
      const { cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();

      const text = modal.contentEl.textContent ?? '';
      expect(text).toContain('Set up your first remote vault');
      expect(text).toContain('Connect to a remote machine');
      // Section headings 1/2/3 are all rendered up front.
      expect(text).toContain('1. Where to connect');
      expect(text).toContain('2. Authentication');
      expect(text).toContain('3. Remote vault path');
    });

    it('starts with a fresh profile (id is a UUID, name "My remote")', () => {
      const { cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      // Read the private profile via cast — test-only access.
      const prof = (modal as unknown as { profile: { id: string; name: string } }).profile;
      expect(prof.name).toBe('My remote');
      expect(prof.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe('validation gates Save & test', () => {
    it('Notices "Host is required" when host is empty on save', async () => {
      const { calls, cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();

      // Direct call to private validate via cast.
      const m = modal as unknown as {
        profile: { host: string; username: string; remotePath: string; authMethod: string };
        saveOnly: () => Promise<void>;
      };
      m.profile.host = '';
      m.profile.username = 'me';
      m.profile.remotePath = '~/notes';
      await m.saveOnly();

      expect(recordedNotices()).toContain('Host is required');
      expect(calls).toHaveLength(0); // didn't fire onFinish
    });

    it('Notices "Username is required" when username is empty', async () => {
      const { calls, cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();

      const m = modal as unknown as {
        profile: { host: string; username: string; remotePath: string };
        saveOnly: () => Promise<void>;
      };
      m.profile.host = 'h';
      m.profile.username = '';
      m.profile.remotePath = '~/notes';
      await m.saveOnly();

      expect(recordedNotices()).toContain('Username is required');
      expect(calls).toHaveLength(0);
    });

    it('Notices "Remote vault path is required" when path is empty', async () => {
      const { calls, cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();

      const m = modal as unknown as {
        profile: { host: string; username: string; remotePath: string };
        saveOnly: () => Promise<void>;
      };
      m.profile.host = 'h';
      m.profile.username = 'me';
      m.profile.remotePath = '';
      await m.saveOnly();

      expect(recordedNotices()).toContain('Remote vault path is required');
      expect(calls).toHaveLength(0);
    });

    it('Notices "Private key path is required" when key auth has no path', async () => {
      const { calls, cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();

      const m = modal as unknown as {
        profile: { host: string; username: string; remotePath: string; authMethod: string; privateKeyPath?: string };
        saveOnly: () => Promise<void>;
      };
      m.profile.host = 'h';
      m.profile.username = 'me';
      m.profile.remotePath = '~/notes';
      m.profile.authMethod = 'privateKey';
      m.profile.privateKeyPath = '';
      await m.saveOnly();

      expect(recordedNotices()).toContain('Private key path is required when using key auth');
      expect(calls).toHaveLength(0);
    });
  });

  describe('Save without testing', () => {
    it('fires onFinish with the profile and dismissOnboarding=true', async () => {
      const { calls, cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();

      const m = modal as unknown as {
        profile: { host: string; username: string; remotePath: string; authMethod: string; privateKeyPath?: string; name: string };
        saveOnly: () => Promise<void>;
      };
      m.profile.host = 'vault.example.com';
      m.profile.username = 'alice';
      m.profile.remotePath = '~/notes';
      m.profile.authMethod = 'password'; // skip the privateKey check
      m.profile.name = 'Test Profile';
      await m.saveOnly();

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        profile: { host: 'vault.example.com', username: 'alice', remotePath: '~/notes', name: 'Test Profile' },
        dismissOnboarding: true,
      });
      expect(recordedNotices()).toContain('Profile saved');
    });
  });

  describe('Skip / dismiss', () => {
    it('fires onFinish with no profile + dismissOnboarding=true on close', async () => {
      const { calls, cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();
      modal.close();

      // onClose fires the dismiss callback synchronously, but it's async
      // internally — flush the microtask queue.
      await Promise.resolve();
      await Promise.resolve();

      expect(calls).toHaveLength(1);
      expect(calls[0].profile).toBeUndefined();
      expect(calls[0].dismissOnboarding).toBe(true);
    });

    it('does NOT fire dismiss twice when close runs after a successful save', async () => {
      const { calls, cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();

      const m = modal as unknown as {
        profile: { host: string; username: string; remotePath: string; authMethod: string; name: string };
        saveOnly: () => Promise<void>;
      };
      m.profile.host = 'h';
      m.profile.username = 'u';
      m.profile.remotePath = '~/n';
      m.profile.authMethod = 'password';
      m.profile.name = 'p';
      await m.saveOnly();
      // saveOnly calls this.close() internally, which triggers onClose,
      // which would re-fire dismiss without the alreadyDismissed guard.

      await Promise.resolve();
      await Promise.resolve();

      expect(calls).toHaveLength(1); // single coalesced save+dismiss
    });
  });
});
