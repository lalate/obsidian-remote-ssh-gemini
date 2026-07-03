import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, MarkdownView, MarkdownFileInfo, Notice, Plugin, TFile } from 'obsidian';
import { ChatController } from './ChatController';
import { RpcRemoteFsClient } from '../adapter/RpcRemoteFsClient';
import { SftpRemoteFsClient } from '../adapter/SftpRemoteFsClient';
import { ConnectionManager } from '../ConnectionManager';

type RemoteFsClient = RpcRemoteFsClient | SftpRemoteFsClient;

export class ChatUI {
  private controller: ChatController | null = null;
  private leafChangeHandler: (() => void) | null = null;

  constructor(
    private app: App,
    private connectionManager: ConnectionManager,
    private plugin: Plugin
  ) {}

  enable(): void {
    this.leafChangeHandler = () => this.updateController();
    this.app.workspace.on('active-leaf-change', this.leafChangeHandler);
    this.updateController();

    this.plugin.addCommand({
      id: 'send-last-chat-section',
      name: 'Send last chat section to LLM',
      editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        void this.handleSendLastSection(editor, ctx);
      },
    });

    this.plugin.registerEditorSuggest(new ChatSectionSuggest(this.app, this));
  }

  disable(): void {
    if (this.leafChangeHandler) {
      this.app.workspace.off('active-leaf-change', this.leafChangeHandler);
      this.leafChangeHandler = null;
    }
    this.controller?.destroy();
    this.controller = null;
  }

  private updateController(): void {
    const profile = this.connectionManager.activeProfile;
    const client = this.connectionManager.buildFsClient();
    if (!profile) {
      this.controller?.destroy();
      this.controller = null;
      return;
    }

    const vaultRoot = this.connectionManager.activeRemoteBasePath ?? profile.remotePath;
    this.controller = new ChatController(this.app, client as RemoteFsClient, () => vaultRoot);
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