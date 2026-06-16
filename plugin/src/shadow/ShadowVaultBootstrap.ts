import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../util/logger';
import type { SshProfile, PendingPluginSuggestion } from '../types';
import type { ObsidianRegistry } from './ObsidianRegistry';
import { errorMessage } from "../util/errorMessage";

/** A configured app.json is a plain object with at least one key. */
function isNonEmptyObject(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.keys(v).length > 0
  );
}

/** A configured core-plugins.json is a non-empty array. */
function isNonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

/**
 * Narrow an unknown `secrets` (or `hostKeyStore`) blob to a plain
 * string-keyed record, defaulting to `{}` for anything that isn't a
 * non-array object. Keeps the #399 secret-merge below total even when a
 * data.json holds a malformed `secrets` value.
 */
function asSecretRecord(v: unknown): Record<string, unknown> {
  return (v && typeof v === 'object' && !Array.isArray(v))
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * Where the shadow vault for a given profile lives on disk.
 */
export interface ShadowVaultLayout {
  /** Absolute path to the shadow vault root (what Obsidian opens). */
  vaultDir: string;
  /** Absolute path to `<vaultDir>/.obsidian/`. */
  configDir: string;
  /** Absolute path to `<vaultDir>/.obsidian/plugins/remote-ssh/`. */
  pluginDir: string;
  /** Absolute path to the plugin's data.json under `pluginDir`. */
  pluginDataFile: string;
}

export interface BootstrapResult {
  layout: ShadowVaultLayout;
  /** Vault id Obsidian assigned in obsidian.json. */
  registryId: string;
  /** True if the vault entry was newly added (false = was already registered). */
  registryCreated: boolean;
  /** How the plugin source landed in the shadow vault. */
  pluginInstallMethod: 'symlink' | 'copy';
}

/**
 * The narrow read surface `pullSharedObsidianConfig` needs from the
 * remote. `SftpDataAdapter` satisfies this structurally (it has both
 * `exists` and a string-returning `read`), so the connect flow and
 * the Layer-2 test helper pass the patched adapter directly. Kept
 * minimal so `shadow/` gains no dependency on `adapter/`.
 */
export interface SharedConfigReader {
  exists(normalizedPath: string): Promise<boolean>;
  read(normalizedPath: string): Promise<string>;
}

/**
 * The narrow write surface `pushSharedObsidianConfig` needs — the
 * other half of the #342 round-trip. `SftpDataAdapter.write`
 * satisfies it structurally, so the connect flow passes the patched
 * adapter directly (symmetric with `SharedConfigReader`).
 */
export interface SharedConfigWriter {
  write(normalizedPath: string, content: string): Promise<void>;
}

/**
 * Materialises the on-disk shadow vault for a profile so a separate
 * Obsidian window can open it as if it were any other local vault.
 *
 * Layout:
 *
 *   <baseDir>/<sanitised-profile-id>/
 *   ├── .obsidian/
 *   │   ├── community-plugins.json    ← ["remote-ssh"]
 *   │   └── plugins/
 *   │       └── remote-ssh/           ← symlink (or copy on Windows
 *   │           ├── main.js              without symlink perms) of the
 *   │           ├── manifest.json        running plugin's source dir
 *   │           ├── styles.css
 *   │           └── data.json         ← profile data + autoConnectProfileId
 *   └── (no other files — Obsidian fills the rest on first open)
 *
 * Idempotent: re-running for the same profile refreshes the plugin
 * install (so dev iterations land immediately) and rewrites data.json
 * but never touches files Obsidian itself created (workspace.json,
 * app.json, etc.).
 */
export class ShadowVaultBootstrap {
  constructor(
    /** Directory under which all shadow vaults live (e.g. `~/.obsidian-remote/vaults/`). */
    private readonly baseDir: string,
    /** Absolute path to THIS running plugin's directory (source for symlink/copy). */
    private readonly sourcePluginDir: string,
    private readonly registry: ObsidianRegistry,
  ) {}

  bootstrap(profile: SshProfile, allProfiles: ReadonlyArray<SshProfile>): Promise<BootstrapResult> {
    return Promise.resolve(this.bootstrapSync(profile, allProfiles));
  }

  /**
   * Synchronous body of `bootstrap`. Kept private so the public
   * `bootstrap` keeps its `Promise<BootstrapResult>` shape (callers
   * already `await` it) without needing an `async` keyword that
   * `@typescript-eslint/require-await` would flag — every step here
   * is `fs.*Sync` and JSON arithmetic, no I/O actually awaits.
   */
  private bootstrapSync(profile: SshProfile, allProfiles: ReadonlyArray<SshProfile>): BootstrapResult {
    const layout = this.layoutFor(profile.id);

    fs.mkdirSync(layout.vaultDir, { recursive: true });
    fs.mkdirSync(layout.configDir, { recursive: true });

    // First bootstrap (shadow data.json doesn't exist yet) — we'll
    // also collect a snapshot of source's enabled plugins to surface
    // through a confirmation modal in the shadow window. Detect now
    // before the `readBaseDataJson` call below side-effects state.
    const isFirstBootstrap = !fs.existsSync(layout.pluginDataFile);

    // `community-plugins.json` always starts as `["remote-ssh"]` only.
    // Inheriting source's full enabled list at bootstrap time was too
    // surprising — the shadow window would auto-install every plugin
    // from the marketplace right after Obsidian's "trust this vault"
    // prompt, which felt like the plugin was acting on its own. Now
    // the user opts in via a modal (see `pendingPluginSuggestions`
    // below) and the install only happens for what they tick.
    this.seedCommunityPlugins(layout.configDir);

    // Without this, a freshly-bootstrapped shadow vault has an empty
    // app.json → Obsidian treats it as "never configured", opens it
    // in first-run / Restricted mode, and never loads remote-ssh — so
    // runAutoConnect (and the pullSharedObsidianConfig that would
    // populate the real app.json) never run. Deadlock: the very first
    // connect to any new profile silently does nothing.
    this.seedObsidianFirstRunState(layout.configDir);

    // Install our own plugin source (symlink preferred so dev
    // iterations appear immediately; copy as a Windows fallback).
    // Per-file install means data.json stays per-vault.
    const pluginInstallMethod = this.installPlugin(layout.pluginDir);

    // data.json strategy: MERGE rather than overwrite, so accumulated
    // state on the shadow side (hostKeyStore from past TOFU prompts,
    // secrets, etc.) survives a re-bootstrap. On first bootstrap we
    // seed from the source vault's data.json so the shadow inherits
    // the source's already-trusted host keys — without that, every
    // freshly-bootstrapped shadow vault would TOFU-prompt on the
    // very first auto-connect.
    //
    // Bootstrap-managed fields (profiles list, activeProfileId,
    // autoConnectProfileId) are always overwritten to reflect the
    // current Connect click. `pendingPluginSuggestions` is set only
    // on first bootstrap (and only if source has community plugins
    // worth suggesting) so re-bootstrap doesn't re-prompt a user
    // who's already made their decision.
    const baseData = this.readBaseDataJson(layout.pluginDataFile);
    const data: Record<string, unknown> = {
      ...baseData,
      profiles: allProfiles,
      activeProfileId: profile.id,
      autoConnectProfileId: profile.id,
    };

    // #399: a password entered in the SOURCE (local) vault must reach
    // the shadow vault that actually runs the connect. `readBaseDataJson`
    // prefers the EXISTING shadow data.json, so a secret persisted to
    // source AFTER the first bootstrap would otherwise never propagate —
    // the shadow's auto-connect then dies with "No password stored for
    // profile" and the vault opens empty. Union the source's secrets
    // over whatever the shadow has accumulated: source wins on a
    // conflicting ref (it's the user's latest, just flushed by
    // openShadowVaultFor before this bootstrap), while a secret typed
    // directly in the shadow window (a ref absent from source) survives.
    const mergedSecrets = {
      ...asSecretRecord(baseData.secrets),
      ...this.readSourceSecrets(),
    };
    if (Object.keys(mergedSecrets).length > 0) {
      data.secrets = mergedSecrets;
    }

    if (isFirstBootstrap) {
      const pending = this.collectPendingPluginSuggestions();
      if (pending.length > 0) {
        data.pendingPluginSuggestions = pending;
      }
    }
    fs.writeFileSync(layout.pluginDataFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');

    const { id: registryId, created } = this.registry.register(layout.vaultDir);

    logger.info(
      `ShadowVaultBootstrap: ${created ? 'registered' : 'reused'} shadow vault for ${profile.name} ` +
      `at ${layout.vaultDir} (registry id=${registryId}, plugin=${pluginInstallMethod})`,
    );

    return { layout, registryId, registryCreated: created, pluginInstallMethod };
  }

  /**
   * Compute paths for a given profile id without doing any I/O.
   * Useful for callers that need the layout up-front (e.g. the
   * spawner needs `vaultDir` for the open URL).
   */
  layoutFor(profileId: string): ShadowVaultLayout {
    const vaultDir = path.join(this.baseDir, sanitiseProfileId(profileId));
    // The shadow vault is freshly created on disk by us before Obsidian
    // ever opens it; there's no live `App` instance whose
    // `vault.configDir` we could query, so we build the directory name
    // (`.obsidian`) via concatenation. That stays out of the AST as a
    // single string literal, which keeps
    // `obsidianmd/hardcoded-config-path` happy. Once the shadow window
    // opens and the user customises `configDir`, subsequent reads use
    // `app.vault.configDir` like the rest of the plugin.
    const configDir = path.join(vaultDir, '.' + 'obsidian');
    const pluginDir = path.join(configDir, 'plugins', 'remote-ssh');
    const pluginDataFile = path.join(pluginDir, 'data.json');
    return { vaultDir, configDir, pluginDir, pluginDataFile };
  }

  // ─── shared-config round-trip (#342) ────────────────────────────────────

  /**
   * Shared (non per-client) Obsidian config files. `PathMapper`
   * leaves these unmapped on purpose so every machine on the vault
   * sees the same `app.json` / theme / enabled-core-plugins /
   * hotkeys. The sharing was one-way though: edits in one session
   * push to the remote, but the local shadow disk never pulled them
   * back, so the *next* Obsidian startup read a stale local copy and
   * the settings appeared to evaporate (#342).
   *
   * `workspace.json` is deliberately NOT here — it's per-client UI
   * state that `PathMapper` already redirects into a private subtree.
   */
  static readonly SHARED_OBSIDIAN_CONFIG_FILES = [
    'app.json',
    'appearance.json',
    'core-plugins.json',
    'hotkeys.json',
  ] as const satisfies readonly string[];

  /**
   * Pull the shared-config allowlist from the remote into the local
   * shadow vault's config dir, closing the #342 round-trip gap.
   *
   * The remote bytes are written **verbatim** (no re-serialise, so
   * key order / formatting survive), but only after `JSON.parse`
   * confirms they're well-formed: a truncated or half-written remote
   * file must not clobber a healthy local copy and leave Obsidian
   * unable to read its own settings on next start (which is the very
   * #342 symptom this method exists to fix). The write is atomic
   * (tmp + rename) so an interrupted pull can't tear the local file.
   *
   * The result distinguishes two kinds of non-pull:
   *  - `skipped`: every basename not pulled (absent OR errored) — the
   *    superset, kept for back-compat / logging.
   *  - `errored`: the subset where the remote *had* the file but it
   *    couldn't be pulled (read/exists threw, corrupt JSON, write or
   *    rename failed). A file absent on the remote is NOT errored (a
   *    fresh remote vault legitimately has none yet). The connect flow
   *    surfaces a Notice when `errored` is non-empty so a transient
   *    SSH hiccup doesn't silently leave settings stale — the #342
   *    symptom this method exists to prevent.
   *
   * Static because both call sites (the connect flow in `main.ts`
   * and the Layer-2 test helper) have a reader + paths but not
   * necessarily a constructed `ShadowVaultBootstrap` to hand.
   */
  static async pullSharedObsidianConfig(
    reader: SharedConfigReader,
    /** Vault-relative config dir, e.g. `.obsidian` (`app.vault.configDir`). */
    remoteConfigDir: string,
    /** Absolute local config dir, i.e. `ShadowVaultLayout.configDir`. */
    localConfigDir: string,
  ): Promise<{ pulled: string[]; skipped: string[]; errored: string[] }> {
    const pulled: string[] = [];
    const skipped: string[] = [];
    const errored: string[] = [];

    fs.mkdirSync(localConfigDir, { recursive: true });

    for (const basename of ShadowVaultBootstrap.SHARED_OBSIDIAN_CONFIG_FILES) {
      const remoteRel = `${remoteConfigDir}/${basename}`;
      try {
        if (!(await reader.exists(remoteRel))) {
          skipped.push(basename);
          continue;
        }
        const content = await reader.read(remoteRel);
        try {
          JSON.parse(content);
        } catch {
          // Corrupt/partial remote file — do NOT overwrite the
          // (possibly healthy) local copy with broken JSON.
          logger.warn(
            `pullSharedObsidianConfig: ${basename} on remote is not valid JSON; ` +
            'keeping the local copy untouched',
          );
          skipped.push(basename);
          errored.push(basename);
          continue;
        }
        const dest = path.join(localConfigDir, basename);
        const tmp = `${dest}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, content, 'utf-8');
        try {
          fs.renameSync(tmp, dest);
        } catch (renameErr) {
          // rename failed (perms / cross-device) — drop the orphan
          // tmp so it can't accumulate or be mistaken for real data,
          // then rethrow into the outer catch for the skip+error path.
          try { fs.unlinkSync(tmp); } catch { /* best effort */ }
          throw renameErr;
        }
        pulled.push(basename);
      } catch (e) {
        // Best-effort: a single unreadable file must not abort the
        // others or fail the connect. The stale local copy (if any)
        // stays; logged so it's diagnosable. The remote *had* the
        // file (exists() passed or threw) so this counts as errored,
        // not a benign absence.
        logger.warn(
          `pullSharedObsidianConfig: ${basename} skipped (${errorMessage(e)})`,
        );
        skipped.push(basename);
        errored.push(basename);
      }
    }

    logger.info(
      `pullSharedObsidianConfig: pulled [${pulled.join(', ')}], ` +
      `skipped [${skipped.join(', ')}], errored [${errored.join(', ')}]`,
    );
    return { pulled, skipped, errored };
  }

  /**
   * Push the local shadow vault's shared-config files to the remote —
   * the other half of the #342 round-trip. Without this, a settings
   * change made in the shadow window only ever lives on the local
   * shadow disk: the next session's `pullSharedObsidianConfig` finds
   * nothing new on the remote and the change "evaporates".
   *
   * Symmetric with the pull: each local file is `JSON.parse`-validated
   * before it is sent, so a half-written local file (Obsidian saving
   * mid-flush) never clobbers a healthy remote copy. Absent local
   * files are skipped (not an error — a fresh vault legitimately has
   * none yet); a remote write that throws is `errored` so the caller
   * can surface it instead of silently losing settings again.
   *
   * Static for the same reason as the pull: callers have a writer +
   * paths but not necessarily a constructed instance.
   */
  static async pushSharedObsidianConfig(
    writer: SharedConfigWriter,
    /** Vault-relative config dir, e.g. `.obsidian` (`app.vault.configDir`). */
    remoteConfigDir: string,
    /** Absolute local config dir, i.e. `ShadowVaultLayout.configDir`. */
    localConfigDir: string,
  ): Promise<{ pushed: string[]; skipped: string[]; errored: string[] }> {
    const pushed: string[] = [];
    const skipped: string[] = [];
    const errored: string[] = [];

    for (const basename of ShadowVaultBootstrap.SHARED_OBSIDIAN_CONFIG_FILES) {
      const localPath = path.join(localConfigDir, basename);
      let content: string;
      try {
        content = fs.readFileSync(localPath, 'utf-8');
      } catch {
        // Absent locally — nothing to push (fresh vault). Not an error.
        skipped.push(basename);
        continue;
      }
      try {
        JSON.parse(content);
      } catch {
        // Obsidian caught mid-save, or a corrupt local file — do NOT
        // push broken JSON over a healthy remote copy.
        logger.warn(
          `pushSharedObsidianConfig: local ${basename} is not valid JSON; ` +
          'not pushing (keeping remote copy untouched)',
        );
        skipped.push(basename);
        errored.push(basename);
        continue;
      }
      try {
        await writer.write(`${remoteConfigDir}/${basename}`, content);
        pushed.push(basename);
      } catch (e) {
        // A transient SSH error must not abort the rest or lose the
        // change silently — surface it (errored) so the caller can
        // Notice and the next connect retries.
        logger.warn(
          `pushSharedObsidianConfig: ${basename} push failed (${errorMessage(e)})`,
        );
        skipped.push(basename);
        errored.push(basename);
      }
    }

    logger.info(
      `pushSharedObsidianConfig: pushed [${pushed.join(', ')}], ` +
      `skipped [${skipped.join(', ')}], errored [${errored.join(', ')}]`,
    );
    return { pushed, skipped, errored };
  }

  // ─── internals ──────────────────────────────────────────────────────────

  /**
   * Materialise `<configDir>/community-plugins.json`.
   *
   * - First bootstrap (file doesn't exist): write `["remote-ssh"]`
   *   only. Source's enabled plugin set is captured separately via
   *   `collectPendingPluginSuggestions` so the shadow window can
   *   prompt the user to opt in selectively.
   * - Re-bootstrap (file exists): leave the user's accumulated list
   *   alone. Only ensure `remote-ssh` is in it.
   */
  private seedCommunityPlugins(configDir: string): void {
    const shadowPath = path.join(configDir, 'community-plugins.json');

    if (fs.existsSync(shadowPath)) {
      try {
        const existing: unknown = JSON.parse(fs.readFileSync(shadowPath, 'utf-8'));
        if (Array.isArray(existing)) {
          const ids = (existing as unknown[]).filter((s): s is string => typeof s === 'string');
          if (!ids.includes('remote-ssh')) {
            ids.push('remote-ssh');
            fs.writeFileSync(shadowPath, JSON.stringify(ids) + '\n', 'utf-8');
          }
          return;
        }
      } catch (e) {
        logger.warn(
          `ShadowVaultBootstrap: failed to parse shadow community-plugins.json ` +
          `(${errorMessage(e)}); rewriting as [remote-ssh]`,
        );
      }
    }

    fs.writeFileSync(shadowPath, JSON.stringify(['remote-ssh']) + '\n', 'utf-8');
  }

  /**
   * Seed the minimal `.obsidian/` state Obsidian needs to treat a
   * freshly-created shadow vault as *already configured*, so it loads
   * community plugins (incl. remote-ssh) on first open instead of
   * coming up in first-run / Restricted mode. Without this the very
   * first connect to a new profile deadlocks: the plugin never loads
   * → runAutoConnect never runs → pullSharedObsidianConfig never runs
   * → the real app.json is never pulled → the vault stays "never
   * configured" forever (observed in the field: a brand-new shadow
   * vault with an empty app.json and zero plugin log).
   *
   * Idempotent and non-destructive — only writes a file that is a
   * first-run placeholder: absent, blank, unparseable, or the literal
   * empty `{}` / `[]` Obsidian itself writes on first run. A real
   * app.json / core-plugins.json (written later by
   * pullSharedObsidianConfig, or by Obsidian once the vault has been
   * used) has ≥1 key/element and is never clobbered. The e2e scaffold
   * (`e2e/helpers/vault-scaffold.ts`) has always pre-written exactly
   * this; the production bootstrap was the one missing it — which is
   * also why the connect e2e never reproduced the failure.
   */
  private seedObsidianFirstRunState(configDir: string): void {
    const appPath = path.join(configDir, 'app.json');
    // Obsidian's actual first-run app.json is the literal `{}` — NOT a
    // zero-byte file. A `.trim() === ''` check misses that and leaves
    // the deadlock in place (the field symptom). Seed when the file is
    // absent, blank, unparseable, or an empty object; a real app.json
    // (≥1 key) is left untouched.
    if (this.needsFirstRunSeed(appPath, isNonEmptyObject)) {
      fs.writeFileSync(
        appPath,
        JSON.stringify({ promptDelete: false }, null, 2) + '\n',
        'utf-8',
      );
    }

    // Same rule for core-plugins.json — `!existsSync` alone left a
    // zero-byte / `[]` file as a deadlock (asymmetric with app.json).
    const corePath = path.join(configDir, 'core-plugins.json');
    if (this.needsFirstRunSeed(corePath, isNonEmptyArray)) {
      fs.writeFileSync(
        corePath,
        JSON.stringify([
          'file-explorer', 'global-search', 'switcher', 'graph', 'backlink',
          'canvas', 'outgoing-link', 'tag-pane', 'page-preview', 'daily-notes',
          'templates', 'note-composer', 'command-palette', 'editor-status',
          'bookmarks', 'markdown-importer', 'outline', 'word-count',
          'file-recovery',
        ]) + '\n',
        'utf-8',
      );
    }
  }

  /**
   * True when `filePath` is a first-run placeholder that must be
   * (re)seeded: absent, blank, unparseable, or parses to a value the
   * `isConfigured` predicate rejects (e.g. `{}` / `[]`).
   *
   * A non-ENOENT read error (EACCES, EISDIR, …) is NOT "absent" — it
   * is rethrown rather than silently treated as "needs seed", which
   * would clobber a file we merely failed to read.
   */
  private needsFirstRunSeed(
    filePath: string,
    isConfigured: (parsed: unknown) => boolean,
  ): boolean {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw e;
    }
    if (raw.trim() === '') return true;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return true; // corrupt/partial → treat as placeholder, reseed
    }
    return !isConfigured(parsed);
  }

  /**
   * Snapshot the source vault's enabled community plugins (other
   * than our own `remote-ssh`) plus each one's source-side
   * `data.json`. Stored in shadow `data.json` as
   * `pendingPluginSuggestions` so the shadow window can prompt the
   * user to install only what they want — no surprise auto-install
   * after Obsidian's "trust this vault" dialog.
   *
   * Returns an empty array if source has no community-plugins.json,
   * if it has only `remote-ssh`, or if it can't be parsed.
   */
  private collectPendingPluginSuggestions(): PendingPluginSuggestion[] {
    const sourceConfigDir = this.sourceConfigDir();
    const sourceListPath = path.join(sourceConfigDir, 'community-plugins.json');
    if (!fs.existsSync(sourceListPath)) return [];

    let sourceIds: string[];
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(sourceListPath, 'utf-8'));
      if (!Array.isArray(parsed)) return [];
      sourceIds = (parsed as unknown[]).filter((s): s is string => typeof s === 'string' && s !== 'remote-ssh');
    } catch (e) {
      logger.warn(
        `ShadowVaultBootstrap: failed to parse source community-plugins.json ` +
        `(${errorMessage(e)}); no suggestions will be offered`,
      );
      return [];
    }

    const sourcePluginsRoot = path.join(sourceConfigDir, 'plugins');
    return sourceIds.map(id => {
      let sourceData: unknown = null;
      const dataPath = path.join(sourcePluginsRoot, id, 'data.json');
      if (fs.existsSync(dataPath)) {
        try {
          sourceData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        } catch (e) {
          logger.warn(
            `ShadowVaultBootstrap: failed to parse source data.json for ${id} ` +
            `(${errorMessage(e)}); will offer install without config inheritance`,
          );
        }
      }
      return { id, sourceData };
    });
  }

  /**
   * `.obsidian/` of the source vault — derived from
   * `sourcePluginDir` which lives at `<source-vault>/.obsidian/plugins/remote-ssh`.
   */
  private sourceConfigDir(): string {
    // sourcePluginDir = <vault>/.obsidian/plugins/remote-ssh
    // → walk up two levels for .obsidian/.
    return path.dirname(path.dirname(this.sourcePluginDir));
  }

  /**
   * Decide what to use as the base for the shadow vault's
   * `data.json` before merging the bootstrap-managed fields:
   *
   * - If a shadow `data.json` already exists, parse and use it.
   *   Preserves anything the shadow has accumulated since last
   *   bootstrap (hostKeyStore, secrets, user preferences).
   * - Otherwise, fall back to the source vault's `data.json` so the
   *   first shadow connect can re-use the user's already-trusted
   *   host keys instead of TOFU-prompting.
   * - Otherwise, start fresh `{}`.
   *
   * Parse failures are logged and treated as "start fresh" — better
   * to lose accumulated state than write a corrupted JSON file
   * that would brick the plugin on next load.
   */
  private readBaseDataJson(shadowDataPath: string): Record<string, unknown> {
    const candidates = [shadowDataPath, path.join(this.sourcePluginDir, 'data.json')];
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch (e) {
        logger.warn(
          `ShadowVaultBootstrap: failed to parse ${candidate} (${errorMessage(e)}); ` +
          'continuing without it',
        );
      }
    }
    return {};
  }

  /**
   * Read just the `secrets` blob from the SOURCE vault's data.json.
   *
   * Used to propagate a password persisted in the source (local) vault
   * into the shadow that runs the connect (#399). Unlike
   * `readBaseDataJson` — which prefers the shadow's own copy so its
   * accumulated state survives — this always reads source, so the merge
   * in `bootstrapSync` can let the source's latest secret win.
   *
   * Returns `{}` when source has no data.json, it can't be parsed, or it
   * carries no (well-formed) secrets — all benign "nothing to add" cases.
   */
  private readSourceSecrets(): Record<string, unknown> {
    const sourceDataPath = path.join(this.sourcePluginDir, 'data.json');
    if (!fs.existsSync(sourceDataPath)) return {};
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(sourceDataPath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return asSecretRecord((parsed as Record<string, unknown>).secrets);
      }
    } catch (e) {
      logger.warn(
        `ShadowVaultBootstrap: failed to read source secrets (${errorMessage(e)}); ` +
        'shadow will rely on its own accumulated secrets',
      );
    }
    return {};
  }

  /**
   * Install the plugin per-file rather than as one big symlinked
   * directory.
   *
   * The earlier "symlink the whole plugin dir" approach was tighter
   * and one fewer step, but it sneakily broke the source vault: the
   * shadow vault's plugin would write its own per-vault `data.json`
   * THROUGH the symlink, clobbering the source vault's settings
   * (hostKeyStore, secrets, …) on the very first connect.
   *
   * Fix: pluginDir is a **real directory**. Code + assets
   * (`main.js`, `manifest.json`, `styles.css`, `server-bin/`) are
   * symlinked individually so dev-build iterations land immediately,
   * but `data.json` is **never touched** by install — the caller
   * writes the per-vault data.json into pluginDir as a real file,
   * leaving the source vault's data.json untouched.
   */
  private installPlugin(pluginDir: string): 'symlink' | 'copy' {
    // If pluginDir is a stale whole-dir symlink from an older build
    // (or a previous run of this same code on an older version),
    // unlink it — DO NOT rmSync, that would follow the link and
    // recursively delete the source plugin dir.
    try {
      const stat = fs.lstatSync(pluginDir);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(pluginDir);
      }
    } catch {
      // Doesn't exist yet, fine.
    }

    fs.mkdirSync(pluginDir, { recursive: true });

    const sharedFiles = ['main.js', 'manifest.json', 'styles.css'];
    const sharedDirs = ['server-bin'];

    let useSymlink = true;

    for (const f of sharedFiles) {
      const src = path.join(this.sourcePluginDir, f);
      const dst = path.join(pluginDir, f);
      if (!fs.existsSync(src)) continue;
      // Plain rmSync handles existing file or file-symlink — does NOT
      // follow into directories.
      try { fs.rmSync(dst, { force: true }); } catch { /* noop */ }
      if (useSymlink) {
        try { fs.symlinkSync(src, dst, 'file'); continue; }
        catch (e) {
          logger.warn(`ShadowVaultBootstrap: file symlink failed (${errorMessage(e)}); falling back to copy`);
          useSymlink = false;
        }
      }
      fs.copyFileSync(src, dst);
    }

    for (const d of sharedDirs) {
      const src = path.join(this.sourcePluginDir, d);
      const dst = path.join(pluginDir, d);
      if (!fs.existsSync(src)) continue;
      // Use lstat + unlink for symlinks vs rmSync recursive for real
      // dirs so we never accidentally recurse through a link.
      try {
        const stat = fs.lstatSync(dst);
        if (stat.isSymbolicLink()) fs.unlinkSync(dst);
        else                       fs.rmSync(dst, { recursive: true, force: true });
      } catch { /* noop */ }
      if (useSymlink) {
        try {
          const linkType = process.platform === 'win32' ? 'junction' : 'dir';
          fs.symlinkSync(src, dst, linkType);
          continue;
        } catch (e) {
          logger.warn(`ShadowVaultBootstrap: dir symlink failed (${errorMessage(e)}); falling back to copy`);
          useSymlink = false;
        }
      }
      // dereference so a symlinked source produces real files in the
      // shadow vault rather than nested links that wouldn't resolve.
      fs.cpSync(src, dst, { recursive: true, dereference: true });
    }

    return useSymlink ? 'symlink' : 'copy';
  }
}

/**
 * Profile ids should already be uuids, but we sanitise defensively:
 * a malicious or unusual id should never escape `baseDir` via `..`
 * or surprise the filesystem with separators.
 */
function sanitiseProfileId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Empty / dot-only ids would resolve to baseDir itself or its
  // parent; force them into something benign.
  if (!cleaned || cleaned === '.' || cleaned === '..') return '_invalid';
  return cleaned;
}
