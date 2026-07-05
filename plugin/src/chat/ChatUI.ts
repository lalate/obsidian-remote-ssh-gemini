import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, MarkdownView, MarkdownFileInfo, Notice, Plugin, TFile, TFolder } from 'obsidian';
import { ChatController } from './ChatController';
import { RpcRemoteFsClient } from '../adapter/RpcRemoteFsClient';
import { SftpRemoteFsClient } from '../adapter/SftpRemoteFsClient';
import { ConnectionManager } from '../ConnectionManager';
import type { PluginSettings } from '../types';

type RemoteFsClient = RpcRemoteFsClient | SftpRemoteFsClient;

export class ChatUI {
  private controller: ChatController | null = null;
  private leafChangeHandler: (() => void) | null = null;
  private statusBarItem: HTMLElement | null = null;

  constructor(
    private app: App,
    private connectionManager: ConnectionManager,
    private plugin: Plugin
  ) {}

  enable(): void {
    this.plugin.addCommand({
      id: 'send-last-chat-section',
      name: 'Send last chat section to LLM',
      editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        void this.handleSendLastSection(editor, ctx);
      },
    });

    this.plugin.addCommand({
      id: 'init-chat-markdown',
      name: 'Init Chat Markdown',
      callback: () => {
        void this.handleInitChatMarkdown();
      },
    });

    this.statusBarItem = this.plugin.addStatusBarItem();
    this.statusBarItem.setText('Send to LLM');
    this.statusBarItem.addClass('remote-ssh-chat-send');
    this.statusBarItem.style.cursor = 'pointer';
    this.statusBarItem.style.display = 'none';
    this.statusBarItem.addEventListener('click', () => {
      void this.handleSendFromStatusBar();
    });

    this.plugin.registerEditorSuggest(new ChatSectionSuggest(this.app, this));

    this.leafChangeHandler = () => {
      this.updateController();
      this.updateStatusBarVisibility();
    };
    this.app.workspace.on('active-leaf-change', this.leafChangeHandler);
    try { this.updateController(); } catch { /* not connected */ }
    this.updateStatusBarVisibility();
  }

  disable(): void {
    if (this.leafChangeHandler) {
      this.app.workspace.off('active-leaf-change', this.leafChangeHandler);
      this.leafChangeHandler = null;
    }
    this.statusBarItem?.remove();
    this.statusBarItem = null;
    this.controller?.destroy();
    this.controller = null;
  }

  private updateStatusBarVisibility(): void {
    if (!this.statusBarItem) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      this.statusBarItem.style.display = 'none';
      return;
    }
    const content = view.editor.getValue();
    const isChatFile = /^## (user|assistant)/im.test(content);
    this.statusBarItem.style.display = isChatFile ? 'inline-flex' : 'none';
  }

  private async handleSendFromStatusBar(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice('No active editor');
      return;
    }
    await this.handleSendLastSection(view.editor, view);
  }

  private async handleInitChatMarkdown(): Promise<void> {
    const ts = new Date().toISOString().slice(0, 16).replace('T', '-').replace(/:/g, '-');
    const baseName = `LLM Chat ${ts}.md`;
    const content = `## user\n\n`;

    let name = baseName;
    let i = 1;
    while (await this.app.vault.adapter.exists(name)) {
      name = `${baseName.replace('.md', '')} (${i}).md`;
      i++;
    }

    try {
      const file = await this.app.vault.create(name, content);
      await this.app.workspace.getLeaf().openFile(file);
      new Notice(`Chat file created: ${name}`);
    } catch (e) {
      new Notice(`Failed to create chat file: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private updateController(): void {
    const profile = this.connectionManager.activeProfile;
    if (!profile) {
      this.controller?.destroy();
      this.controller = null;
      return;
    }

    const client = this.connectionManager.buildFsClient();
    const vaultRoot = this.connectionManager.activeRemoteBasePath ?? profile.remotePath;
    this.controller = new ChatController(this.app, client as RemoteFsClient, () => vaultRoot);
    const settings = (this.plugin as { settings: PluginSettings }).settings;
    this.controller.setToolConfig(settings.llmToolName ?? 'gemini', settings.llmToolArgs ?? {});
  }

  private async handleSendLastSection(editor: Editor, ctx: MarkdownView | MarkdownFileInfo): Promise<void> {
    if (!this.controller) {
      new Notice('Not connected to a remote vault');
      return;
    }
    const file = 'file' in ctx ? ctx.file : null;
    if (!file) return;
    await this.controller.sendLastSection(editor, file);
  }
}

class ChatSectionSuggest extends EditorSuggest<string> {
  constructor(app: App, private chatUI: ChatUI) {
    super(app);
  }

  getSuggestions(context: EditorSuggestContext): string[] {
    const line = context.query;
    if (line.trim() === '## User' || line.trim() === '## Assistant') {
      return ['', ' (press Cmd+Shift+Enter to send)'];
    }
    return [];
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
    el.addClass('chat-section-suggest');
  }

  selectSuggestion(_value: string, _evt: MouseEvent | KeyboardEvent): void {
    // no-op
  }

  onTrigger(cursor: EditorPosition, _editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const line = _editor.getLine(cursor.line);
    if (line.trim() === '## User' || line.trim() === '## Assistant') {
      return { start: { line: cursor.line, ch: 0 }, end: { line: cursor.line, ch: line.length }, query: line };
    }
    return null;
  }
}
