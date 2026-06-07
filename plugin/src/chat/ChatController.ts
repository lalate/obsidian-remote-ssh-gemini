import { App, Editor, Notice, TFile } from 'obsidian';
import { RpcRemoteFsClient } from '../adapter/RpcRemoteFsClient';
import { SftpRemoteFsClient } from '../adapter/SftpRemoteFsClient';
import { parseChatFile, extractLastUserSection, replaceAssistantResponse, ensureChatFileStructure } from './ChatParser';
import type { CliOutputBatchParams, CliDoneParams, ExtensionInvokeParams, ExtensionInvokeResult } from '../proto/types';

type RemoteFsClient = RpcRemoteFsClient | SftpRemoteFsClient;

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

  constructor(
    private app: App,
    private client: RemoteFsClient,
    private getVaultRoot: () => string
  ) {}

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
      await this.app.vault.modify(file, structuredText);
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
      const result = await this.callExtensionInvoke({
        tool: 'gemini',
        args: { prompt },
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

  private setupStreamHandlers(editor: Editor, _file: TFile): void {
    const onBatch = (params: CliOutputBatchParams) => {
      if (params.invocationId !== this.currentInvocationId) return;
      for (const item of params.items) {
        if (item.stream === 'stdout') {
          this.pendingResponse += item.data;
        }
      }
      this.updateEditorWithResponse(editor);
    };

    const onDone = (params: CliDoneParams) => {
      if (params.invocationId !== this.currentInvocationId) return;
      this.cleanup();
      this.isStreaming = false;
      this.currentInvocationId = null;
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

  private updateEditorWithResponse(editor: Editor): void {
    const text = editor.getValue();
    const newText = replaceAssistantResponse(text, this.pendingResponse);
    if (newText !== text) {
      editor.setValue(newText);
    }
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