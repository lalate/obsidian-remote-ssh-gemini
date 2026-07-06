import { App, Editor, Notice, TFile } from 'obsidian';
import { RpcRemoteFsClient } from '../adapter/RpcRemoteFsClient';
import { SftpRemoteFsClient } from '../adapter/SftpRemoteFsClient';
import { ensureChatFileStructure } from './ChatParser';

type RemoteFsClient = RpcRemoteFsClient | SftpRemoteFsClient;

function assertRpcClient(c: RemoteFsClient): asserts c is RpcRemoteFsClient {
  if (!('invokeExtension' in c)) throw new Error('Chat requires RPC transport');
}

const POLL_INTERVAL_MS = 1500;

export class ChatController {
  private isProcessing = false;
  private _toolName = 'opencode';
  private _toolArgs: Record<string, string> = {};
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollFile: TFile | null = null;
  private lastPollContent = '';

  constructor(
    private app: App,
    private client: RemoteFsClient,
    private getVaultRoot: () => string,
  ) {}

  setToolConfig(toolName: string, toolArgs: Record<string, string> = {}): void {
    this._toolName = toolName;
    this._toolArgs = toolArgs;
  }

  async sendLastSection(editor: Editor, file: TFile): Promise<void> {
    if (this.isProcessing) {
      new Notice('Already processing a chat request');
      return;
    }

    const text = editor.getValue();
    const structuredText = ensureChatFileStructure(text);
    if (structuredText !== text) {
      editor.setValue(structuredText);
    }

    // Save user's input to the server before kicking off LLM.
    await this.app.vault.modify(file, editor.getValue());

    assertRpcClient(this.client);
    try {
      const argsList: string[] = Object.values(this._toolArgs).filter(Boolean);
      const result = await this.client.chatStart({
        filePath: file.path,
        tool: this._toolName,
        args: argsList,
      });
      if (!result.accepted) {
        new Notice('Chat request rejected by server');
        return;
      }
    } catch (e) {
      new Notice(`Failed to start chat: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    this.isProcessing = true;
    this.pollFile = file;
    this.lastPollContent = text; // start from the save-time snapshot so the first poll is a no-op
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

        this.lastPollContent = content;
        editor.setValue(content);

        // Detect completion: ## User heading appears after ## Assistant.
        if (pollCount > 1 && hasUserAfterAssistant(content)) {
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
}

function hasUserAfterAssistant(content: string): boolean {
  const asstRe = /^##\s+Assistant\s*$/im;
  const userRe = /^##\s+User\s*$/im;
  const asstMatch = asstRe.exec(content);
  if (!asstMatch) return false;
  const afterAsst = content.slice(asstMatch.index + asstMatch[0].length);
  return userRe.test(afterAsst);
}
