import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findChatSessionsAsync } from '../src/chat/ChatSessionListModal';

function makeFile(name: string, mtime: number) {
  return {
    basename: name.replace('.md', ''),
    path: name,
    stat: { mtime, size: 100, ctime: 0 },
  };
}

describe('findChatSessionsAsync', () => {
  let mockApp: {
    vault: {
      getMarkdownFiles: ReturnType<typeof vi.fn>;
      cachedRead: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockApp = {
      vault: {
        getMarkdownFiles: vi.fn(),
        cachedRead: vi.fn(),
      },
    };
  });

  it('returns empty array when no markdown files exist', async () => {
    mockApp.vault.getMarkdownFiles.mockReturnValue([]);
    const result = await findChatSessionsAsync(mockApp as never);
    expect(result).toEqual([]);
  });

  it('skips files without ai_session in frontmatter', async () => {
    const file = makeFile('regular-note.md', 1000);
    mockApp.vault.getMarkdownFiles.mockReturnValue([file]);
    mockApp.vault.cachedRead.mockResolvedValue('# Regular Note\n\nSome content');
    const result = await findChatSessionsAsync(mockApp as never);
    expect(result).toEqual([]);
  });

  it('includes files with ai_session in frontmatter', async () => {
    const file = makeFile('chat-1.md', 2000);
    mockApp.vault.getMarkdownFiles.mockReturnValue([file]);
    mockApp.vault.cachedRead.mockResolvedValue(
      '---\nai_session: abc-123\nai_model: claude-sonnet-4\nai_agent: auto\n---\n\n# AI Conversation\n\n## User\n\nHello world\n\n## Assistant\n\nHi there!\n',
    );
    const result = await findChatSessionsAsync(mockApp as never);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe(file);
    expect(result[0].meta.ai_session).toBe('abc-123');
    expect(result[0].meta.ai_model).toBe('claude-sonnet-4');
    expect(result[0].preview).toBe('Hello world');
  });

  it('sorts by mtime descending (newest first)', async () => {
    const oldFile = makeFile('old-chat.md', 1000);
    const newFile = makeFile('new-chat.md', 3000);
    const midFile = makeFile('mid-chat.md', 2000);
    mockApp.vault.getMarkdownFiles.mockReturnValue([oldFile, newFile, midFile]);
    mockApp.vault.cachedRead.mockImplementation(async (f: { basename: string }) => {
      const sessions: Record<string, string> = {
        'old-chat': '---\nai_session: old\n---\n\n## User\n\nold msg\n',
        'new-chat': '---\nai_session: new\n---\n\n## User\n\nnew msg\n',
        'mid-chat': '---\nai_session: mid\n---\n\n## User\n\nmid msg\n',
      };
      return sessions[f.basename] ?? '';
    });
    const result = await findChatSessionsAsync(mockApp as never);
    expect(result).toHaveLength(3);
    expect(result[0].file.basename).toBe('new-chat');
    expect(result[1].file.basename).toBe('mid-chat');
    expect(result[2].file.basename).toBe('old-chat');
  });

  it('truncates preview to 120 chars and strips newlines', async () => {
    const file = makeFile('long-chat.md', 1000);
    mockApp.vault.getMarkdownFiles.mockReturnValue([file]);
    const longMsg = 'A'.repeat(200);
    mockApp.vault.cachedRead.mockResolvedValue(
      `---\nai_session: x\n---\n\n## User\n\n${longMsg}\n\n## Assistant\n\nresponse\n`,
    );
    const result = await findChatSessionsAsync(mockApp as never);
    expect(result).toHaveLength(1);
    expect(result[0].preview.length).toBeLessThanOrEqual(120);
    expect(result[0].preview).toBe('A'.repeat(120));
  });

  it('handles multiline user message by joining with spaces', async () => {
    const file = makeFile('multi.md', 1000);
    mockApp.vault.getMarkdownFiles.mockReturnValue([file]);
    mockApp.vault.cachedRead.mockResolvedValue(
      '---\nai_session: x\n---\n\n## User\n\nline one\nline two\nline three\n\n## Assistant\n\nresponse\n',
    );
    const result = await findChatSessionsAsync(mockApp as never);
    expect(result[0].preview).toBe('line one line two line three');
  });

  it('shows "(no user message)" when no user messages exist', async () => {
    const file = makeFile('no-user.md', 1000);
    mockApp.vault.getMarkdownFiles.mockReturnValue([file]);
    mockApp.vault.cachedRead.mockResolvedValue(
      '---\nai_session: x\n---\n\n## Assistant\n\nunsolicited response\n',
    );
    const result = await findChatSessionsAsync(mockApp as never);
    expect(result[0].preview).toBe('(no user message)');
  });

  it('skips files that throw on read', async () => {
    const goodFile = makeFile('good.md', 2000);
    const badFile = makeFile('bad.md', 3000);
    mockApp.vault.getMarkdownFiles.mockReturnValue([badFile, goodFile]);
    mockApp.vault.cachedRead.mockImplementation(async (f: { basename: string }) => {
      if (f.basename === 'bad') throw new Error('read failed');
      return '---\nai_session: ok\n---\n\n## User\n\nhi\n';
    });
    const result = await findChatSessionsAsync(mockApp as never);
    expect(result).toHaveLength(1);
    expect(result[0].file.basename).toBe('good');
  });
});
