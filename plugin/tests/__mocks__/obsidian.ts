/**
 * Runtime mock for the `obsidian` module.
 *
 * The published `obsidian` npm package is *types only* — there's no
 * implementation of `Modal`, `Setting`, `Notice`, etc. UI tests that
 * `import { Modal } from 'obsidian'` need a runtime to instantiate.
 * Vitest resolves `import 'obsidian'` here via the `resolve.alias`
 * entry in `vitest.config.ts`.
 *
 * Surface: only the slice the plugin's UI / settings code actually
 * touches (Modal, Setting, Notice, PluginSettingTab, FileSystemAdapter
 * stub, plus the `el.createEl / createDiv / createSpan / addClass /
 * removeClass / setText` Obsidian DOM extensions). Add more as new
 * UI files start importing them.
 *
 * Tests that need to assert on Notices or the rendered DOM use:
 *   - `recordedNotices()` — every Notice that's been constructed
 *   - `clearNotices()` — drop the buffer between tests
 */

// ─── Notice ──────────────────────────────────────────────────────────

const noticeBuffer: string[] = [];

export class Notice {
  constructor(public readonly message: string, public readonly timeoutMs?: number) {
    noticeBuffer.push(message);
  }
}

export function recordedNotices(): readonly string[] {
  return [...noticeBuffer];
}

export function clearNotices(): void {
  noticeBuffer.length = 0;
}

// ─── DOM extensions ──────────────────────────────────────────────────
//
// Obsidian extends HTMLElement with a few helpers. Patch the prototype
// once at module load so source code that calls `el.createEl(...)`
// works against jsdom or Node's WHATWG-DOM-less env. We use the global
// `document` if available (jsdom); otherwise we synthesise a minimal
// element tree that supports the methods Obsidian-extended elements
// have.

interface DomOptions {
  text?: string;
  cls?: string | string[];
  type?: string;
  attr?: Record<string, string | number | boolean>;
  placeholder?: string;
  href?: string;
}

function applyDomOptions(el: HTMLElement, opts?: DomOptions): void {
  if (!opts) return;
  if (opts.text !== undefined) el.textContent = opts.text;
  if (opts.cls) {
    const cls = Array.isArray(opts.cls) ? opts.cls : [opts.cls];
    for (const c of cls) el.classList.add(c);
  }
  if (opts.type !== undefined) (el as HTMLInputElement).type = opts.type;
  if (opts.placeholder !== undefined) (el as HTMLInputElement).placeholder = opts.placeholder;
  if (opts.href !== undefined) (el as HTMLAnchorElement).href = opts.href;
  if (opts.attr) {
    for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, String(v));
  }
}

function patchDom(): void {
  if (typeof HTMLElement === 'undefined') return;
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (proto._obsidianMockPatched) return;

  proto.createEl = function <K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement, tag: K, opts?: DomOptions,
  ): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    applyDomOptions(el as HTMLElement, opts);
    this.appendChild(el);
    return el;
  };
  proto.createDiv = function (this: HTMLElement, opts?: DomOptions | string): HTMLDivElement {
    const o: DomOptions | undefined = typeof opts === 'string' ? { cls: opts } : opts;
    return (this as unknown as { createEl: <K extends 'div'>(t: K, o?: DomOptions) => HTMLDivElement })
      .createEl('div', o);
  };
  proto.createSpan = function (this: HTMLElement, opts?: DomOptions | string): HTMLSpanElement {
    const o: DomOptions | undefined = typeof opts === 'string' ? { cls: opts } : opts;
    return (this as unknown as { createEl: <K extends 'span'>(t: K, o?: DomOptions) => HTMLSpanElement })
      .createEl('span', o);
  };
  proto.empty = function (this: HTMLElement): void {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  proto.addClass = function (this: HTMLElement, c: string): void {
    this.classList.add(c);
  };
  proto.removeClass = function (this: HTMLElement, c: string): void {
    this.classList.remove(c);
  };
  proto.setText = function (this: HTMLElement, t: string): void {
    this.textContent = t;
  };
  proto.toggleClass = function (this: HTMLElement, c: string, on: boolean): void {
    this.classList.toggle(c, on);
  };

  proto._obsidianMockPatched = true;
}

patchDom();

// ─── Setting ─────────────────────────────────────────────────────────
//
// Chainable. Each `add*` returns the Setting itself (matching the real
// API). The component callbacks (text/toggle/etc.) receive a small
// shim with the same chainable surface the production callers expect.

interface TextComponent {
  setValue(v: string): TextComponent;
  setPlaceholder(p: string): TextComponent;
  onChange(cb: (v: string) => void | Promise<void>): TextComponent;
  /** Test helper: simulate user typing. */
  simulateInput(v: string): Promise<void>;
}

interface ToggleComponent {
  setValue(v: boolean): ToggleComponent;
  onChange(cb: (v: boolean) => void | Promise<void>): ToggleComponent;
  /** Test helper: simulate flipping the toggle. */
  simulateChange(v: boolean): Promise<void>;
}

interface ButtonComponent {
  setButtonText(t: string): ButtonComponent;
  setCta(): ButtonComponent;
  setWarning(): ButtonComponent;
  setDisabled(b: boolean): ButtonComponent;
  setText(t: string): ButtonComponent;
  onClick(cb: () => void | Promise<void>): ButtonComponent;
  buttonEl: HTMLButtonElement;
  /** Test helper: simulate the click. */
  simulateClick(): Promise<void>;
}

interface DropdownComponent {
  addOption(value: string, label: string): DropdownComponent;
  setValue(v: string): DropdownComponent;
  onChange(cb: (v: string) => void | Promise<void>): DropdownComponent;
  /** Test helper: simulate selection change. */
  simulateChange(v: string): Promise<void>;
}

function makeText(): TextComponent {
  let value = '';
  let onChange: ((v: string) => void | Promise<void>) | null = null;
  const c: TextComponent = {
    setValue(v) { value = v; return c; },
    setPlaceholder() { return c; },
    onChange(cb) { onChange = cb; return c; },
    async simulateInput(v) {
      value = v;
      if (onChange) await onChange(v);
    },
  };
  return c;
}

function makeToggle(): ToggleComponent {
  let onChange: ((v: boolean) => void | Promise<void>) | null = null;
  const c: ToggleComponent = {
    setValue() { return c; },
    onChange(cb) { onChange = cb; return c; },
    async simulateChange(v) { if (onChange) await onChange(v); },
  };
  return c;
}

function makeButton(): ButtonComponent {
  let onClick: (() => void | Promise<void>) | null = null;
  const buttonEl = (typeof document !== 'undefined' ? document.createElement('button') : ({} as HTMLButtonElement));
  const c: ButtonComponent = {
    setButtonText(t) { (buttonEl as HTMLButtonElement).textContent = t; return c; },
    setCta() { return c; },
    setWarning() { return c; },
    setDisabled(b) { (buttonEl as HTMLButtonElement).disabled = b; return c; },
    setText(t) { (buttonEl as HTMLButtonElement).textContent = t; return c; },
    onClick(cb) { onClick = cb; return c; },
    buttonEl,
    async simulateClick() { if (onClick) await onClick(); },
  };
  return c;
}

function makeDropdown(): DropdownComponent {
  let onChange: ((v: string) => void | Promise<void>) | null = null;
  const c: DropdownComponent = {
    addOption() { return c; },
    setValue() { return c; },
    onChange(cb) { onChange = cb; return c; },
    async simulateChange(v) { if (onChange) await onChange(v); },
  };
  return c;
}

export class Setting {
  /** Last-attached components, in attach order. Test helper. */
  readonly components: Array<TextComponent | ToggleComponent | ButtonComponent | DropdownComponent> = [];
  /** The row this Setting renders into (a child of containerEl). */
  readonly settingEl: HTMLElement;
  private nameEl: HTMLElement;
  private descEl: HTMLElement;
  private controlEl: HTMLElement;
  private isHeading = false;

  constructor(public readonly containerEl: HTMLElement) {
    // Mirror the real Obsidian DOM tree shape just enough for tests
    // that walk `.textContent` to see Setting names + descriptions.
    this.settingEl = document.createElement('div');
    this.settingEl.className = 'setting-item';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'setting-item-name';
    this.descEl = document.createElement('div');
    this.descEl.className = 'setting-item-description';
    this.controlEl = document.createElement('div');
    this.controlEl.className = 'setting-item-control';
    this.settingEl.appendChild(this.nameEl);
    this.settingEl.appendChild(this.descEl);
    this.settingEl.appendChild(this.controlEl);
    containerEl.appendChild(this.settingEl);
  }

  setName(n: string): this { this.nameEl.textContent = n; return this; }
  setDesc(d: string): this { this.descEl.textContent = d; return this; }
  setHeading(): this {
    this.isHeading = true;
    this.settingEl.classList.add('setting-item-heading');
    return this;
  }

  addText(cb: (t: TextComponent) => void): this {
    const t = makeText();
    cb(t);
    this.components.push(t);
    return this;
  }
  addToggle(cb: (t: ToggleComponent) => void): this {
    const t = makeToggle();
    cb(t);
    this.components.push(t);
    return this;
  }
  addButton(cb: (b: ButtonComponent) => void): this {
    const b = makeButton();
    cb(b);
    this.controlEl.appendChild(b.buttonEl);
    this.components.push(b);
    return this;
  }
  addDropdown(cb: (d: DropdownComponent) => void): this {
    const d = makeDropdown();
    cb(d);
    this.components.push(d);
    return this;
  }

  /** Test introspection. */
  getName(): string { return this.nameEl.textContent ?? ''; }
  getDesc(): string { return this.descEl.textContent ?? ''; }
  isHeadingSetting(): boolean { return this.isHeading; }
}

// ─── Modal / PluginSettingTab ────────────────────────────────────────

export class Modal {
  contentEl: HTMLElement;
  modalEl: HTMLElement;

  constructor(public readonly app: App) {
    this.modalEl = document.createElement('div');
    this.contentEl = document.createElement('div');
    this.modalEl.appendChild(this.contentEl);
  }

  open(): void { this.onOpen(); }
  close(): void { this.onClose(); }

  onOpen(): void { /* override */ }
  onClose(): void { /* override */ }
}

export class PluginSettingTab {
  containerEl: HTMLElement;
  app: App;

  constructor(app: App, public readonly plugin: Plugin) {
    this.app = app;
    this.containerEl = document.createElement('div');
  }

  display(): void { /* override */ }
  hide(): void { /* override */ }
}

// ─── App / Plugin / Vault / FileSystemAdapter ────────────────────────

export interface Workspace {
  onLayoutReady(cb: () => void): void;
}

export class App {
  vault: Vault = new Vault();
  workspace: Workspace = { onLayoutReady: (cb) => cb() };
}

export class Vault {
  adapter: FileSystemAdapter = new FileSystemAdapter();
  configDir = '.obsidian';
  getName(): string { return 'TestVault'; }
}

export class FileSystemAdapter {
  private basePath = '/synthetic/vault';
  getBasePath(): string { return this.basePath; }
  setBasePath(p: string): void { this.basePath = p; }
}

export class Plugin {
  manifest = { id: 'remote-ssh', name: 'Remote SSH', version: '0.0.0', minAppVersion: '1.0.0', description: '', author: '', isDesktopOnly: true };
  app: App;

  constructor(app: App, manifest?: Partial<Plugin['manifest']>) {
    this.app = app;
    if (manifest) this.manifest = { ...this.manifest, ...manifest };
  }

  /** Test helper: returns the element so the harness can spy on its content. */
  addStatusBarItem(): HTMLElement {
    return document.createElement('div');
  }
  addCommand(): void { /* no-op for the harness */ }
  addSettingTab(): void { /* no-op */ }
}

// ─── Re-exported types ───────────────────────────────────────────────
//
// The plugin uses `import type` for these elsewhere. Re-export so
// `import type { TFile } from 'obsidian'` resolves.

export type EventRef = symbol;
export type TFile = unknown;
export type TFolder = unknown;
export type TAbstractFile = unknown;
export type DataWriteOptions = unknown;
export type ListedFiles = unknown;
export type Stat = unknown;
export type CachedMetadata = unknown;
export type FrontMatterCache = unknown;
export type HeadingCache = unknown;
export type ListItemCache = unknown;
export type PluginManifest = Plugin['manifest'];

// Augment the global HTMLElement with the Obsidian DOM helpers so
// production source code typechecks against this mock.
declare global {
  interface HTMLElement {
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, opts?: DomOptions): HTMLElementTagNameMap[K];
    createDiv(opts?: DomOptions | string): HTMLDivElement;
    createSpan(opts?: DomOptions | string): HTMLSpanElement;
    empty(): void;
    addClass(c: string): void;
    removeClass(c: string): void;
    setText(t: string): void;
    toggleClass(c: string, on: boolean): void;
    _obsidianMockPatched?: boolean;
  }
}
