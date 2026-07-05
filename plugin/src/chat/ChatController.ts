import { App, Editor, Notice, TFile } from 'obsidian';
import { RpcRemoteFsClient } from '../adapter/RpcRemoteFsClient';
import { SftpRemoteFsClient } from '../adapter/SftpRemoteFsClient';
import { parseChatFile, extractLastUserSection, replaceAssistantResponse, ensureChatFileStructure } from './ChatParser';
import type { CliOutputBatchParams, CliDoneParams, ExtensionInvokeParams, ExtensionInvokeResult } from '../proto/types';

type RemoteFsClient = RpcRemoteFsClient | SftpRemoteFsClient;

/** Helper: narrows to RpcRemoteFsClient when extension support is present. */
function assertRpcClient(c: RemoteFsClient): asserts c is RpcRemoteFsClient {
  if (!('invokeExtension' in c)) throw new Error('Extension invoke not supported on this transport');
}
const CHAT_TAIL_BYTES = 64 * 1024; // 64KB - enough for recent messages

type Disposer = () => void;

function hasExtensionSupport(client: RemoteFsClient): client is RpcRemoteFsClient {
  return 'invokeExtension' in client && typeof client.invokeExtension === 'function';
}

export class ChatController {
  private currentInvocationId: string | null = null;
  private disposers: Disposer[] = [];
  private pendingResponse = '';
  private isStreaming = false;
  private _toolName = 'gemini';
  private _toolArgs: Record<string, string> = {};

  constructor(
    private app: App,
    private client: RemoteFsClient,
    private getVaultRoot: () => string
  ) {}

  setToolConfig(toolName: string, toolArgs: Record<string, string> = {}): void {
    this._toolName = toolName;
    this._toolArgs = toolArgs;
  }

  async sendLastSection(editor: Editor, file: TFile): Promise<void> {
    const text = editor.getValue();
    const userContent = extractLastUserSection(text);

    if (!userContent || !userContent.trim()) {
      new Notice('No user message found. Add a "## user" section with content.');
      return;
    }

    const structuredText = ensureChatFileStructure(text);
    if (structuredText !== text) {
      editor.setValue(structuredText);
      // Don't save to remote here — let streaming updates handle it,
      // otherwise auto-save races with fs.watch notifications.
    }

    await this.invokeLlm(editor, file, userContent.trim());
  }

  /** Fetch only the last N bytes of a chat file from remote. */
  async fetchChatTail(remotePath: string): Promise<string> {
    try {
      const stat = await this.client.stat(remotePath);
      if (!stat.isFile) return '';
      const fileSize = stat.size;
      const offset = Math.max(0, fileSize - CHAT_TAIL_BYTES);
      const length = fileSize - offset;
      assertRpcClient(this.client);
      const result = await this.client.readBinaryRange(remotePath, offset, length);
      return result.data.toString('utf8');
    } catch (e) {
      if (e instanceof Error && e.message.includes('no such file')) {
        return '';
      }
      throw e;
    }
  }

  /** Get the last user message from remote chat file without loading entire file. */
  async getLastUserMessage(remotePath: string): Promise<string | null> {
    const tail = await this.fetchChatTail(remotePath);
    if (!tail) return null;
    const parsed = parseChatFile(tail);
    return parsed.lastUserMessage?.content ?? null;
  }

  private async invokeLlm(editor: Editor, file: TFile, prompt: string): Promise<void> {
    if (this.isStreaming) {
      new Notice('Already streaming a response');
      return;
    }

    this.isStreaming = true;
    this.pendingResponse = '';

    try {
      const vaultRoot = this.getVaultRoot();
      const args: Record<string, unknown> = { ...this._toolArgs, prompt };
      const result = await this.callExtensionInvoke({
        tool: this._toolName,
        args,
        workingDir: vaultRoot,
        persist: true,
      });

      this.currentInvocationId = result.invocationId;

      this.setupStreamHandlers(editor, file);

      new Notice(`LLM started (${result.invocationId})`);
    } catch (e) {
      this.isStreaming = false;
      this.currentInvocationId = null;
      new Notice(`Failed to start LLM: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async callExtensionInvoke(params: ExtensionInvokeParams): Promise<ExtensionInvokeResult> {
    if (!hasExtensionSupport(this.client)) {
      throw new Error('Extension invoke not supported on this transport');
    }
    return this.client.invokeExtension(params);
  }

  private replaceAssistantContent(editor: Editor): void {
    const ASST_RE = /^##\s+Assistant\s*$/i;
    const lineCount = editor.lineCount();
    let headingLine = -1;
    for (let i = lineCount - 1; i >= 0; i--) {
      if (ASST_RE.test(editor.getLine(i))) { headingLine = i; break; }
    }
    if (headingLine === -1) {
      const text = editor.getValue();
      const newText = text.trimEnd() + '\n\n## Assistant\n\n' + this.pendingResponse.trim() + '\n';
      if (newText !== text) editor.setValue(newText);
      return;
    }
    const from = { line: headingLine + 1, ch: 0 };
    const to = { line: lineCount - 1, ch: editor.getLine(lineCount - 1).length };
    editor.replaceRange(this.pendingResponse.trimEnd() + '\n', from, to);
  }

  private setupStreamHandlers(editor: Editor, file: TFile): void {
    assertRpcClient(this.client);
    const onBatch = (params: CliOutputBatchParams) => {
      if (params.invocationId !== this.currentInvocationId) return;
      for (const item of params.items) {
        if (item.stream === 'stdout') {
          this.pendingResponse += item.data;
        }
      }
      this.replaceAssistantContent(editor);
    };

    const onDone = async (params: CliDoneParams) => {
      if (params.invocationId !== this.currentInvocationId) return;
      this.cleanup();
      this.isStreaming = false;
      this.currentInvocationId = null;

      if (this.pendingResponse) {
        this.replaceAssistantContent(editor);
        try { await this.app.vault.modify(file, editor.getValue()); } catch (e) { /* write-through */ }
      }

      if (params.exitCode !== 0) {
        new Notice(`LLM finished with exit code ${params.exitCode}`);
      } else {
        new Notice('LLM response complete');
      }
    };

    const disposeBatch = this.client.onCliOutputBatch(onBatch);
    const disposeDone = this.client.onCliDone(onDone);

    this.disposers.push(disposeBatch, disposeDone);
  }

  private cleanup(): void {
    for (const d of this.disposers) {
      try { d(); } catch (_) { /* ignore disposal errors */ }
    }
    this.disposers = [];
  }

  destroy(): void {
    this.cleanup();
    this.isStreaming = false;
    this.currentInvocationId = null;
  }
}
