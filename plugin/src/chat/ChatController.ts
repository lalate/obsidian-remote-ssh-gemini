import { App, Editor, Notice, TFile } from 'obsidian';
import { RpcRemoteFsClient } from '../adapter/RpcRemoteFsClient';
import { SftpRemoteFsClient } from '../adapter/SftpRemoteFsClient';
import { ensureChatFileStructure, parseFrontmatter, mergeFrontmatter, type FrontmatterMeta } from './ChatParser';
import type { AiSessionMeta } from '../proto/types';
import { logger } from '../util/logger';

type RemoteFsClient = RpcRemoteFsClient | SftpRemoteFsClient;

function assertRpcClient(c: RemoteFsClient): asserts c is RpcRemoteFsClient {
  if (!('invokeExtension' in c)) throw new Error('Chat requires RPC transport');
}

const POLL_INTERVAL_MS = 1500;

export class ChatController {
  private isProcessing = false;
  /** Tool name from settings (override) — empty means use server-discovered default. */
  private _settingsToolName = '';
  private _settingsToolArgs: Record<string, string> = {};
  /** Selected model identifier (e.g. "opencode/big-pickle"). */
  private _settingsModel = '';
  /** Selected agent name (e.g. "auto", "architect"). */
  private _settingsAgent = '';
  /** Tool discovered from server via chat.status. */
  private _discoveredToolCommand = '';
  private _hasServerConfig = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollFile: TFile | null = null;
  private lastPollContent = '';
  /** Session metadata written into file frontmatter on each chat start. */
  private _meta: FrontmatterMeta = {};

  constructor(
    private app: App,
    private client: RemoteFsClient,
    private getVaultRoot: () => string,
  ) {}

  setToolConfig(toolName: string, toolArgs: Record<string, string> = {}, model?: string, agent?: string): void {
    this._settingsToolName = toolName;
    this._settingsToolArgs = toolArgs;
    this._settingsModel = model ?? '';
    this._settingsAgent = agent ?? '';
  }

  /**
   * Query the server for the configured LLM tool and store the resolved
   * command path. Falls back to settings if the server has no config.
   * Safe to call multiple times — the latest result overwrites.
   */
  async refreshToolConfig(): Promise<boolean> {
    if (!('chatStatus' in this.client)) {
      return false;
    }
    try {
      const status = await (this.client as RpcRemoteFsClient).chatStatus();
      if (status.healthy && status.tools.length > 0) {
        const def = status.tools.find(t => t.tool === status.defaultTool) ?? status.tools[0];
        if (def.command) {
          this._discoveredToolCommand = def.command;
          this._hasServerConfig = true;
          return true;
        }
      }
    } catch {
      // Server not reachable — settings fallback remains in place.
    }
    return false;
  }

  /** Return the effective command to pass as `tool` in chat.start. */
  private resolveCommand(): string {
    return this._settingsToolName || this._discoveredToolCommand || 'opencode';
  }

  setMeta(meta: FrontmatterMeta): void {
    this._meta = meta;
  }

  async sendLastSection(editor: Editor, file: TFile): Promise<void> {
    if (this.isProcessing) {
      new Notice('Already processing a chat request');
      return;
    }

    // Flush pending RPC writes (autosave, etc.) before reading editor state.
    // vault.read forces a round-trip to the server, serializing any queued
    // operations ahead of the subsequent vault.modify — preventing a race
    // where an in-flight autosave write arrives at the server after our modify.
    await this.app.vault.read(file).catch(() => {});

    const text = editor.getValue();
    const textLines = text.split('\n').length;
    logger.info('Chat sendLastSection enter', { file: file.name, lines: textLines, textLen: text.length });

    const structuredText = ensureChatFileStructure(text);
    if (structuredText !== text) {
      const cursor = editor.getCursor();
      editor.setValue(structuredText);
      const afterLines = structuredText.split('\n').length;
      logger.info('Chat ensureChatFileStructure restructured', { before: textLines, after: afterLines });
      const lastLine = editor.lastLine();
      editor.setCursor(Math.min(cursor.line, lastLine), 0);
      editor.scrollIntoView({ from: { line: lastLine, ch: 0 }, to: { line: lastLine, ch: 0 } }, true);
    }

    const saveContent = editor.getValue();
    const saveLines = saveContent.split('\n').length;
    logger.info('Chat before vault.modify', { lines: saveLines, textLen: saveContent.length });
    await this.app.vault.modify(file, saveContent);
    logger.info('Chat after vault.modify', { cursor: editor.getCursor() });

    assertRpcClient(this.client);
    const tool = this.resolveCommand();
    const argsList: string[] = [];
    // Prepend --model / --agent from settings so they come before tool args
    if (this._settingsModel) argsList.push('--model', this._settingsModel);
    if (this._settingsAgent) argsList.push('--agent', this._settingsAgent);
    argsList.push(...Object.values(this._settingsToolArgs).filter(Boolean));
    let contentForWrite = saveContent;

    try {
      // Ensure session ID exists in file frontmatter
      const { meta: fileMeta } = parseFrontmatter(saveContent);
      let sessionId = fileMeta.ai_session || this._meta.ai_session;
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        contentForWrite = mergeFrontmatter(saveContent, { ai_session: sessionId });
        editor.setValue(contentForWrite);
        await this.app.vault.modify(file, contentForWrite);
      }

      logger.info('Chat calling chatStart', { tool, args: argsList, filePath: file.path, sessionId, hasServerConfig: this._hasServerConfig });
      const sessionMeta: AiSessionMeta = {
        session: sessionId,
        agent: this._meta.ai_agent || fileMeta.ai_agent,
        model: this._meta.ai_model || fileMeta.ai_model,
      };
      const result = await this.client.chatStart({
        filePath: file.path,
        tool,
        args: argsList,
        sessionMeta,
      });
      logger.info('Chat chatStart result', { result });
      if (!result.accepted) {
        new Notice('Chat request rejected by server');
        return;
      }
    } catch (e) {
      new Notice(`Failed to start chat: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const processingContent = contentForWrite.trimEnd() + '\n\n## Assistant\n\n';
    await this.app.vault.modify(file, processingContent);
    editor.setValue(processingContent);
    editor.setCursor(editor.lastLine(), 0);

    this.isProcessing = true;
    this.pollFile = file;
    this.lastPollContent = processingContent;
    logger.info('Chat polling started', { intervalMs: POLL_INTERVAL_MS, lastPollLines: processingContent.split('\n').length });
    this.startPolling(editor, file);
    new Notice('Chat processing on server');
  }

  private startPolling(editor: Editor, file: TFile): void {
    this.stopPolling();
    let pollCount = 0;
    this.pollTimer = setInterval(async () => {
      pollCount++;
      try {
        const content = await this.app.vault.read(file);
        if (content === this.lastPollContent) return;

        const newLines = content.split('\n').length;
        const oldLines = this.lastPollContent.split('\n').length;
        logger.info('Chat poll content changed', { pollCount, oldLines, newLines, textLen: content.length });
        this.lastPollContent = content;

        // Check if editor has unsaved user input — if so, skip overwriting
        const currentEditorValue = editor.getValue();
        if (currentEditorValue === content || currentEditorValue.length < content.length) {
          // Editor is in-sync or has less content (no pending user input) — safe to update
          editor.setValue(content);
          const editorLineCount = editor.lineCount();
          const cursorAfterSet = editor.getCursor();
          logger.info('Chat poll editor.setValue done', { pollCount, editorLineCount, cursor: cursorAfterSet });
          editor.setCursor(editor.lastLine(), 0);
          editor.scrollIntoView(
            { from: { line: editor.lastLine(), ch: 0 }, to: { line: editor.lastLine(), ch: 0 } },
            true,
          );
        } else {
          // Editor has MORE content than server — user is typing, don't overwrite
          logger.info('Chat poll editor has pending input, skipping setValue', {
            pollCount,
            editorLen: currentEditorValue.length,
            serverLen: content.length,
          });
        }

        if (pollCount > 1 && hasUserAfterAssistant(content)) {
          logger.info('Chat poll COMPLETE detected', { pollCount });
          this.stopPolling();
          this.isProcessing = false;
          this.pollFile = null;
          new Notice('Chat response complete');
        }
      } catch (e) {
        console.error('Chat poll error:', e);
      }
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  destroy(): void {
    this.stopPolling();
    this.isProcessing = false;
    this.pollFile = null;
  }

  async cancel(): Promise<void> {
    if (!this.isProcessing) {
      new Notice('No chat currently processing');
      return;
    }
    this.stopPolling();
    if ('chatCancel' in this.client) {
      const filePath = this.pollFile?.path ?? '';
      if (filePath) {
        try {
          const result = await (this.client as RpcRemoteFsClient).chatCancel({ filePath });
          if (result.killed) {
            new Notice('Chat processing cancelled');
          } else {
            new Notice('No running chat process to cancel');
          }
        } catch {
          new Notice('Failed to cancel chat processing');
        }
      }
    }
    this.isProcessing = false;
    this.pollFile = null;
  }

  async debugChatState(editor: Editor, file: TFile): Promise<void> {
    logger.info('Chat debug state start', { file: file.name });

    // 1. Editor state
    const editorContent = editor.getValue();
    const editorLines = editorContent.split('\n');
    const cursor = editor.getCursor();
    logger.info('Chat debug editor state', {
      lines: editorLines.length,
      textLen: editorContent.length,
      cursor,
      isProcessing: this.isProcessing,
      pollFile: this.pollFile?.name ?? null,
    });

    // 2. Server file content (via vault.read)
    let serverContent: string;
    try {
      serverContent = await this.app.vault.read(file);
      const serverLines = serverContent.split('\n');
      logger.info('Chat debug server state', {
        lines: serverLines.length,
        textLen: serverContent.length,
      });
    } catch (e) {
      logger.info('Chat debug server read error', { error: e instanceof Error ? e.message : String(e) });
      new Notice('Debug: failed to read file from server');
      return;
    }

    // 3. Compare
    const diff: { line: number; editor: string; server: string }[] = [];
    const maxLines = Math.max(editorLines.length, serverContent.split('\n').length);
    const serverLines = serverContent.split('\n');
    for (let i = 0; i < maxLines; i++) {
      const e = editorLines[i] ?? null;
      const s = serverLines[i] ?? null;
      if (e !== s) {
        diff.push({ line: i + 1, editor: e ?? '(missing)', server: s ?? '(missing)' });
      }
    }

    logger.info('Chat debug diff', {
      diffCount: diff.length,
      // limit detail to first 20 differences to avoid oversized log
      samples: diff.slice(0, 20),
    });

    if (diff.length === 0) {
      new Notice('Debug: editor and server are in sync');
    } else {
      new Notice(`Debug: ${diff.length} line(s) differ between editor and server (see preview logs)`);
    }
  }
}

function hasUserAfterAssistant(content: string): boolean {
  const userRe = /^##\s+User\s*$/im;
  const globalAsstRe = /^##\s+Assistant\s*$/gim;
  let lastAsstIndex = -1;
  let lastAsstMatchLen = 0;
  let m: RegExpExecArray | null;
  while ((m = globalAsstRe.exec(content)) !== null) {
    lastAsstIndex = m.index;
    lastAsstMatchLen = m[0].length;
  }
  if (lastAsstIndex === -1) return false;
  const afterAsst = content.slice(lastAsstIndex + lastAsstMatchLen);
  return userRe.test(afterAsst);
}
