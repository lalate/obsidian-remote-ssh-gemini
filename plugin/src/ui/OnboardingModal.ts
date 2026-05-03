import { Modal, App, Setting, Notice } from 'obsidian';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { SshProfile } from '../types';
import type { AuthResolver } from '../ssh/AuthResolver';
import type { HostKeyStore } from '../ssh/HostKeyStore';
import { SftpClient } from '../ssh/SftpClient';
import { readSshConfig, type SshConfigEntry } from '../ssh/SshConfigReader';
import { generateEd25519KeyPair } from '../ssh/SshKeyGen';
import { RemotePathBrowserModal } from './RemotePathBrowserModal';
import { DEFAULT_PROFILE, ONBOARDING_FALLBACK_KEY_FILENAME } from '../constants';
import { errorMessage } from '../util/errorMessage';
import { logger } from '../util/logger';

export interface OnboardingDeps {
  authResolver: AuthResolver;
  hostKeyStore: HostKeyStore;
}

/**
 * Callback fired when the user finishes the wizard. The plugin must
 * persist `profile` (when present) and `dismissOnboarding` (when true)
 * in a SINGLE saveSettings call to avoid the double-write race
 * (M2 in the PR-222 review).
 */
export type OnboardingFinishCallback = (opts: {
  profile?: SshProfile;
  dismissOnboarding: boolean;
}) => Promise<void>;

/**
 * F17 — first-launch onboarding wizard. A single modal that walks
 * the user from "no profiles configured" to "ready to connect" in
 * <5 clicks when an `~/.ssh/config` host already exists, or with a
 * one-button ed25519 key generation flow when starting from scratch.
 *
 * On dismiss (Save or Skip), `markCompleted` flips `onboardingCompleted`
 * so this doesn't re-open on every layout-ready. The user can
 * re-launch from the command palette anytime.
 */
export class OnboardingModal extends Modal {
  private profile: SshProfile;
  private hasExistingKey = false;
  private existingKeyPath: string | null = null;

  /** True once `onFinish({dismissOnboarding: true})` has run, to avoid double-dismiss in onClose. */
  private alreadyDismissed = false;

  constructor(
    app: App,
    private readonly deps: OnboardingDeps,
    private readonly onFinish: OnboardingFinishCallback,
  ) {
    super(app);
    this.profile = {
      ...DEFAULT_PROFILE,
      id: crypto.randomUUID(),
      name: 'My remote',
    };
    this.detectExistingKey();
  }

  onOpen() {
    this.renderBody();
  }

  onClose() {
    this.contentEl.empty();
    // Mark complete on any close so the modal doesn't reopen on the
    // next launch. The user can always re-run from the command palette.
    // Save+test paths already passed dismissOnboarding=true and set
    // `alreadyDismissed`, so this is a no-op for them.
    if (this.alreadyDismissed) return;
    this.alreadyDismissed = true;
    this.onFinish({ dismissOnboarding: true }).catch(e => {
      logger.error(`OnboardingModal: dismiss persist failed: ${errorMessage(e)}`);
    });
  }

  private detectExistingKey(): void {
    const candidates = [
      path.join(os.homedir(), '.ssh', 'id_ed25519'),
      path.join(os.homedir(), '.ssh', 'id_rsa'),
    ];
    for (const c of candidates) {
      try {
        if (fs.existsSync(c)) {
          this.hasExistingKey = true;
          this.existingKeyPath = c;
          this.profile.privateKeyPath = c;
          return;
        }
      } catch { /* permission denied — treat as missing */ }
    }
  }

  private renderBody() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('remote-ssh-onboarding');
    contentEl.createEl('h2', { text: 'Set up your first remote vault' });
    contentEl.createEl('p', {
      text:
        'Connect to a remote machine over SSH and edit its vault from this Obsidian window. ' +
        'You can change everything later in settings.',
      cls: 'setting-item-description',
    });

    this.renderHostSection(contentEl);
    this.renderAuthSection(contentEl);
    this.renderRemotePathSection(contentEl);
    this.renderActions(contentEl);
  }

  // ─── Section 1: host ──────────────────────────────────────────────

  private renderHostSection(parent: HTMLElement) {
    new Setting(parent).setName('1. Where to connect').setHeading();

    const sshEntries = readSshConfig();
    if (sshEntries.length > 0) {
      new Setting(parent)
        .setName('Import from SSH config')
        .setDesc(
          `Found ${sshEntries.length} host${sshEntries.length === 1 ? '' : 's'} in ~/.ssh/config. ` +
          'Pick one to fill the fields below.',
        )
        .addDropdown(d => {
          d.addOption('', '— select host —');
          for (const e of sshEntries) d.addOption(e.alias, e.alias);
          d.onChange(alias => {
            if (!alias) return;
            const entry = sshEntries.find(x => x.alias === alias);
            if (entry) this.applySshConfig(entry);
          });
        });
    }

    new Setting(parent)
      .setName('Profile name')
      .addText(t => t.setValue(this.profile.name)
        .onChange(v => { this.profile.name = v; }));

    new Setting(parent)
      .setName('Host')
      .setDesc('Hostname or IP of the remote machine.')
      .addText(t => t.setPlaceholder('vault.example.com').setValue(this.profile.host)
        .onChange(v => { this.profile.host = v; }));

    new Setting(parent)
      .setName('Port')
      .addText(t => t.setValue(String(this.profile.port))
        .onChange(v => { const n = parseInt(v, 10); if (Number.isFinite(n) && n > 0) this.profile.port = n; }));

    new Setting(parent)
      .setName('Username')
      .addText(t => t.setPlaceholder(os.userInfo().username).setValue(this.profile.username)
        .onChange(v => { this.profile.username = v; }));
  }

  // ─── Section 2: auth ──────────────────────────────────────────────

  private renderAuthSection(parent: HTMLElement) {
    new Setting(parent).setName('2. Authentication').setHeading();

    const desc = this.hasExistingKey
      ? `Found existing key at ${this.existingKeyPath}. We'll use it by default.`
      : 'No SSH key found. Generate a fresh ed25519 keypair below or pick "Password" to skip.';
    parent.createEl('p', { text: desc, cls: 'setting-item-description' });

    new Setting(parent)
      .setName('Method')
      .addDropdown(d => d
        .addOption('privateKey', 'Private key')
        .addOption('password',   'Password')
        .addOption('agent',      'SSH agent')
        .setValue(this.profile.authMethod)
        .onChange(v => {
          this.profile.authMethod = v as SshProfile['authMethod'];
        }));

    new Setting(parent)
      .setName('Private key path')
      .setDesc('Where to read (or create) the SSH private key.')
      .addText(t => t.setPlaceholder(path.join(os.homedir(), '.ssh', 'id_ed25519'))
        .setValue(this.profile.privateKeyPath ?? '')
        .onChange(v => { this.profile.privateKeyPath = v || undefined; }));

    new Setting(parent)
      .setName('Generate new ed25519 key')
      .setDesc(
        'Creates a fresh keypair at the path above and shows the public key ' +
        'so you can paste it into the remote\'s ~/.ssh/authorized_keys.',
      )
      .addButton(btn => btn
        .setButtonText('Generate')
        .onClick(() => void this.generateKey(parent)));
  }

  private async generateKey(parent: HTMLElement) {
    const target = (this.profile.privateKeyPath?.trim() || '')
      || path.join(os.homedir(), '.ssh', ONBOARDING_FALLBACK_KEY_FILENAME);
    if (!path.isAbsolute(target)) {
      new Notice('Private key path must be absolute');
      return;
    }
    try {
      const userLabel = this.profile.username || os.userInfo().username;
      // generateEd25519KeyPair uses fs.open('wx') so an existing path
      // surfaces as EEXIST here — atomic, no TOCTOU window.
      const { publicKey } = await generateEd25519KeyPair(
        target,
        `obsidian-remote@${userLabel}`,
      );
      this.profile.privateKeyPath = target;
      this.profile.authMethod = 'privateKey';
      this.hasExistingKey = true;
      this.existingKeyPath = target;
      this.showPublicKeyHint(parent, publicKey, target);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const msg = code === 'EEXIST'
        ? `Refusing to overwrite existing key at ${target}`
        : `Key generation failed: ${errorMessage(e)}`;
      new Notice(msg);
      logger.error(`OnboardingModal.generateKey failed: ${errorMessage(e)}`);
    }
  }

  private showPublicKeyHint(parent: HTMLElement, publicKey: string, keyPath: string) {
    parent.querySelector('.remote-ssh-onboarding-pubkey')?.remove();
    const box = parent.createDiv({ cls: 'remote-ssh-onboarding-pubkey' });
    new Setting(box).setName('Add this key to the remote host').setHeading();
    box.createEl('p', {
      text: `Saved private key: ${keyPath}`,
      cls: 'setting-item-description',
    });
    box.createEl('p', {
      text:
        'Append the public key below to the remote\'s ~/.ssh/authorized_keys. ' +
        'You may need to mkdir + chmod 700 ~/.ssh first.',
      cls: 'setting-item-description',
    });
    const pre = box.createEl('pre', { cls: 'remote-ssh-onboarding-pubkey-pre' });
    pre.textContent = publicKey;
    new Setting(box).addButton(btn => btn
      .setButtonText('Copy public key')
      .setCta()
      .onClick(() => {
        void navigator.clipboard.writeText(publicKey);
        new Notice('Public key copied to clipboard');
      }));
  }

  // ─── Section 3: remote path ───────────────────────────────────────

  private renderRemotePathSection(parent: HTMLElement) {
    new Setting(parent).setName('3. Remote vault path').setHeading();

    new Setting(parent)
      .setName('Path')
      .setDesc('Absolute path on the remote, or `~/relative` (home-relative).')
      .addText(t => t.setPlaceholder('~/notes').setValue(this.profile.remotePath)
        .onChange(v => { this.profile.remotePath = v; }))
      .addButton(btn => btn
        .setButtonText('Browse…')
        .onClick(() => {
          if (!this.profile.host || !this.profile.username) {
            new Notice('Fill in host and username first');
            return;
          }
          new RemotePathBrowserModal(
            this.app,
            this.profile,
            this.deps.authResolver,
            this.deps.hostKeyStore,
            (selectedPath) => {
              this.profile.remotePath = selectedPath;
              this.renderBody();
            },
          ).open();
        }));
  }

  // ─── Section 4: save / test / skip ────────────────────────────────

  private renderActions(parent: HTMLElement) {
    new Setting(parent)
      .addButton(btn => btn
        .setButtonText('Save & test connection')
        .setCta()
        .onClick(() => void this.saveAndTest(btn.buttonEl)))
      .addButton(btn => btn
        .setButtonText('Save without testing')
        .onClick(() => void this.saveOnly()))
      .addButton(btn => btn
        .setButtonText('Skip')
        .onClick(() => this.close()));
  }

  private validate(): string | null {
    if (!this.profile.host.trim())     return 'Host is required';
    if (!this.profile.username.trim()) return 'Username is required';
    if (!this.profile.remotePath.trim()) return 'Remote vault path is required';
    if (this.profile.authMethod === 'privateKey' && !this.profile.privateKeyPath?.trim()) {
      return 'Private key path is required when using key auth';
    }
    return null;
  }

  private async saveOnly() {
    const err = this.validate();
    if (err) { new Notice(err); return; }
    this.alreadyDismissed = true;
    await this.onFinish({ profile: this.profile, dismissOnboarding: true });
    new Notice('Profile saved');
    this.close();
  }

  private async saveAndTest(btnEl: HTMLButtonElement) {
    const err = this.validate();
    if (err) { new Notice(err); return; }

    btnEl.setText('Testing…');
    btnEl.disabled = true;

    const client = new SftpClient(this.deps.authResolver, this.deps.hostKeyStore);
    try {
      await client.connect(this.profile);
      await client.list(this.profile.remotePath);
      await client.disconnect();
      this.alreadyDismissed = true;
      await this.onFinish({ profile: this.profile, dismissOnboarding: true });
      new Notice(`Profile saved — connected to ${this.profile.host}`);
      this.close();
    } catch (e) {
      btnEl.setText('Save & test connection');
      btnEl.disabled = false;
      new Notice(`Connection test failed: ${errorMessage(e)}`);
      try { await client.disconnect(); } catch { /* ignore */ }
    }
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private applySshConfig(entry: SshConfigEntry) {
    if (entry.hostname)     this.profile.host = entry.hostname;
    if (entry.user)         this.profile.username = entry.user;
    if (entry.port)         this.profile.port = entry.port;
    if (entry.identityFile) {
      this.profile.privateKeyPath = entry.identityFile;
      this.profile.authMethod = 'privateKey';
    }
    this.profile.name = entry.alias;
    this.renderBody();
  }
}
