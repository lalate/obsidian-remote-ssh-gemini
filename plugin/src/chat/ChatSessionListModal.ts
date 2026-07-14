import { App, Modal, TFile } from 'obsidian';
import { parseFrontmatter, parseChatFile, type FrontmatterMeta } from './ChatParser';

/**
 * Metadata extracted from a chat file for display in the session list.
 */
export interface ChatSessionEntry {
  file: TFile;
  meta: FrontmatterMeta;
  /** First user message content (truncated preview). */
  preview: string;
}

/**
 * Scan the vault for chat session files (markdown files with `ai_session`
 * in YAML frontmatter) and return them sorted by modification time (newest first).
 */
export async function findChatSessionsAsync(app: App): Promise<ChatSessionEntry[]> {
  const entries: ChatSessionEntry[] = [];
  const files = app.vault.getMarkdownFiles();

  for (const file of files) {
    try {
      const content = await app.vault.cachedRead(file);
      const { meta } = parseFrontmatter(content);

      // Only include files that have an ai_session field (i.e. actual chat files).
      if (!meta.ai_session) continue;

      // Extract first user message as preview.
      const parsed = parseChatFile(content);
      const firstUser = parsed.messages.find(m => m.role === 'user');
      const preview = firstUser
        ? firstUser.content.trim().slice(0, 120).replace(/\n/g, ' ')
        : '(no user message)';

      entries.push({ file, meta, preview });
    } catch {
      // Skip unreadable files.
    }
  }

  // Sort by mtime descending (newest first).
  entries.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);

  return entries;
}

/**
 * Format a frontmatter meta into a short subtitle line for the session list.
 * e.g. "model: claude-sonnet-4 · agent: auto · 2026-07-14 10:24"
 */
function formatSubtitle(meta: FrontmatterMeta, mtimeMs: number): string {
  const parts: string[] = [];

  if (meta.ai_model) parts.push(`model: ${meta.ai_model}`);
  if (meta.ai_agent) parts.push(`agent: ${meta.ai_agent}`);

  const date = new Date(mtimeMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  parts.push(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`);

  return parts.join(' · ');
}

/**
 * Modal that lists past AI chat sessions found in the vault.
 * Click a session to open it in the editor.
 */
export class ChatSessionListModal extends Modal {
  private entries: ChatSessionEntry[] = [];

  constructor(app: App) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Chat sessions' });

    const loadingEl = contentEl.createEl('p', { text: 'Scanning vault for chat files…', cls: 'setting-item-description' });

    try {
      this.entries = await findChatSessionsAsync(this.app);
    } catch (e) {
      loadingEl.setText(`Error scanning vault: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    loadingEl.remove();

    if (this.entries.length === 0) {
      contentEl.createEl('p', {
        text: 'No chat sessions found. Start a conversation with "send last chat section to LLM".',
        cls: 'setting-item-description',
      });
      return;
    }

    const listEl = contentEl.createEl('div', { cls: 'chat-session-list' });

    for (const entry of this.entries) {
      const itemEl = listEl.createEl('div', { cls: 'chat-session-item' });

      // Title: file name without extension.
      const title = entry.file.basename;
      itemEl.createEl('div', { text: title, cls: 'chat-session-title' });

      // Subtitle: model · agent · date.
      const subtitle = formatSubtitle(entry.meta, entry.file.stat.mtime);
      itemEl.createEl('div', { text: subtitle, cls: 'chat-session-subtitle' });

      // Preview: first user message.
      if (entry.preview) {
        itemEl.createEl('div', { text: entry.preview, cls: 'chat-session-preview' });
      }

      // Click handler: open the file.
      itemEl.addEventListener('click', () => {
        void (async () => {
          const leaf = this.app.workspace.getLeaf();
          await leaf.openFile(entry.file);
          this.close();
        })();
      });

      itemEl.addClass('clickable');
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
