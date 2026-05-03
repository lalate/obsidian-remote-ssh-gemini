import { describe, it, expect, vi } from 'vitest';
import { OnboardingModal, type OnboardingFinishCallback } from '../../src/ui/OnboardingModal';
import { App, recordedNotices } from 'obsidian';
import type { AuthResolver } from '../../src/ssh/AuthResolver';
import type { HostKeyStore } from '../../src/ssh/HostKeyStore';
import type { SshProfile } from '../../src/types';

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

// Single typed accessor for the modal's private surface. Six tests
// previously redeclared this shape inline; renaming `saveOnly` would
// have failed silently in each one with "not a function" at runtime.
interface ModalInternals {
  profile: SshProfile;
  saveOnly: () => Promise<void>;
}
function internals(m: OnboardingModal): ModalInternals {
  return m as unknown as ModalInternals;
}

function fillValidProfile(p: SshProfile, overrides: Partial<SshProfile> = {}) {
  p.host = 'h';
  p.username = 'u';
  p.remotePath = '~/n';
  p.authMethod = 'password';
  p.name = 'p';
  Object.assign(p, overrides);
}

describe('OnboardingModal', () => {
  describe('initial render', () => {
    it('renders the wizard heading + intro paragraph on open', () => {
      const { cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();

      const text = modal.contentEl.textContent ?? '';
      expect(text).toContain('Set up your first remote vault');
      expect(text).toContain('Connect to a remote machine');
      expect(text).toContain('1. Where to connect');
      expect(text).toContain('2. Authentication');
      expect(text).toContain('3. Remote vault path');
    });

    it('starts with a fresh profile (id is a UUID, name "My remote")', () => {
      const { cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      const prof = internals(modal).profile;
      expect(prof.name).toBe('My remote');
      expect(prof.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe('validation gates Save & test', () => {
    it('Notices "Host is required" when host is empty on save', async () => {
      const { calls, cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();

      const m = internals(modal);
      m.profile.host = '';
      m.profile.username = 'me';
      m.profile.remotePath = '~/notes';
      await m.saveOnly();

      expect(recordedNotices()).toContain('Host is required');
      expect(calls).toHaveLength(0);
    });

    it('Notices "Username is required" when username is empty', async () => {
      const { calls, cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();

      const m = internals(modal);
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

      const m = internals(modal);
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

      const m = internals(modal);
      m.profile.host = 'h';
      m.profile.username = 'me';
      m.profile.remotePath = '~/notes';
      m.profile.authMethod = 'privateKey';
      m.profile.privateKeyPath = '';
      await m.saveOnly();

      expect(recordedNotices()).toContain('Private key path is required when using key auth');
      expect(calls).toHaveLength(0);
    });

    it('Browse button with empty host fires "Fill in host and username first" Notice', async () => {
      const { cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();
      const m = internals(modal);
      m.profile.host = '';
      m.profile.username = '';

      // Locate the Browse button under the "3. Remote vault path"
      // section and click it. The empty-host guard short-circuits
      // before RemotePathBrowserModal is constructed.
      const browse = Array.from(modal.contentEl.querySelectorAll('button'))
        .find(b => (b.textContent ?? '').trim() === 'Browse…');
      expect(browse).toBeTruthy();
      browse!.click();
      await Promise.resolve();

      expect(recordedNotices()).toContain('Fill in host and username first');
    });
  });

  describe('Save without testing', () => {
    it('fires onFinish with the profile and dismissOnboarding=true', async () => {
      const { calls, cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();

      const m = internals(modal);
      m.profile.host = 'vault.example.com';
      m.profile.username = 'alice';
      m.profile.remotePath = '~/notes';
      m.profile.authMethod = 'password';
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

      // onClose's dismiss is fire-and-forget — wait until the recorded
      // call lands rather than guessing how many microtask ticks deep
      // the SUT chain is.
      await vi.waitFor(() => expect(calls).toHaveLength(1));

      expect(calls[0].profile).toBeUndefined();
      expect(calls[0].dismissOnboarding).toBe(true);
    });

    it('does NOT fire dismiss twice when close runs after a successful save', async () => {
      const { calls, cb } = recordingFinish();
      const modal = new OnboardingModal(new App(), deps, cb);
      modal.open();

      const m = internals(modal);
      fillValidProfile(m.profile);
      await m.saveOnly();
      // saveOnly calls this.close() internally, which triggers onClose;
      // the alreadyDismissed guard is what prevents a second onFinish.

      await vi.waitFor(() => expect(calls).toHaveLength(1));
      // Give the onClose microtask chain a chance to re-fire if the
      // guard is missing — if it does, calls.length will tick up.
      await new Promise(r => setTimeout(r, 10));
      expect(calls).toHaveLength(1);
    });
  });
});
