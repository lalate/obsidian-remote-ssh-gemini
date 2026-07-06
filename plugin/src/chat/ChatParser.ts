export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  headingLine: number;
  contentStartLine: number;
  contentEndLine: number;
}

export interface ParsedChat {
  messages: ChatMessage[];
  fullText: string;
  lastUserMessage: ChatMessage | null;
}

export interface FrontmatterMeta {
  ai_session?: string;
  ai_agent?: string;
  ai_model?: string;
  ai_updated?: string;
  [key: string]: string | undefined;
}

const USER_HEADING = /^##\s+User\s*$/i;
const ASSISTANT_HEADING = /^##\s+Assistant\s*$/i;

export const DEFAULT_CHAT_TEMPLATE = `---
ai_agent: auto
---

# AI Conversation

## User

`;

// ─── Frontmatter helpers ─────────────────────────────────────────────────────

/**
 * Returns true when the text starts with YAML frontmatter (--- delimiter).
 */
export function hasFrontmatter(text: string): boolean {
  return /^---\s*\n/.test(text);
}

/**
 * Extract YAML frontmatter from text that begins with `---\n`.
 * Returns the raw frontmatter block (with delimiters), the body after it,
 * and a key-value map of parsed fields.
 */
export function parseFrontmatter(text: string): {
  block: string;
  body: string;
  meta: FrontmatterMeta;
} {
  const meta: FrontmatterMeta = {};
  if (!hasFrontmatter(text)) {
    return { block: '', body: text, meta };
  }

  const rest = text.slice(text.indexOf('\n') + 1); // after first ---\n
  const endIdx = rest.indexOf('\n---');
  if (endIdx < 0) {
    return { block: '', body: text, meta };
  }

  const fmLines = rest.slice(0, endIdx);
  const block = text.slice(0, endIdx + 5); // include ---\n...\n---\n
  const body = rest.slice(endIdx + 5);      // past trailing ---\n

  for (const raw of fmLines.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    let val = line.slice(sep + 1).trim();
    val = val.replace(/^["']|["']$/g, '');
    if (val) meta[key] = val;
  }

  return { block, body, meta };
}

/**
 * Render a FrontmatterMeta into a YAML block including delimiters.
 * Only includes keys that have non-empty string values.
 */
export function renderFrontmatter(meta: FrontmatterMeta): string {
  const lines: string[] = ['---'];
  for (const [key, val] of Object.entries(meta)) {
    if (val !== undefined && val !== '') {
      // Quote if value contains special chars
      if (/[:\n"']/.test(val)) {
        lines.push(`${key}: "${val.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${val}`);
      }
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Merge meta values into the text's frontmatter (adds frontmatter if absent).
 * Preserves existing frontmatter fields not in `updates`.
 */
export function mergeFrontmatter(text: string, updates: FrontmatterMeta): string {
  const { block, body, meta } = parseFrontmatter(text);
  const merged: FrontmatterMeta = { ...meta, ...updates };
  // Remove keys with undefined values (explicit deletion)
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) delete merged[k];
  }
  const newBlock = renderFrontmatter(merged);
  if (!block) {
    // No existing frontmatter → insert at top
    return newBlock + '\n\n' + body.trimStart();
  }
  return newBlock + '\n\n' + body.trimStart();
}

// ─── Chat parsing ────────────────────────────────────────────────────────────

export function parseChatFile(text: string): ParsedChat {
  const lines = text.split('\n');
  const messages: ChatMessage[] = [];
  let currentRole: 'user' | 'assistant' | null = null;
  let headingLine = -1;
  let contentStartLine = -1;
  let contentLines: string[] = [];

  function flushCurrent() {
    if (currentRole && headingLine >= 0) {
      const content = contentLines.join('\n').trimEnd();
      messages.push({
        role: currentRole,
        content,
        headingLine,
        contentStartLine,
        contentEndLine: contentStartLine + contentLines.length - 1,
      });
    }
    currentRole = null;
    headingLine = -1;
    contentStartLine = -1;
    contentLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const userMatch = line.match(USER_HEADING);
    const assistantMatch = line.match(ASSISTANT_HEADING);

    if (userMatch || assistantMatch) {
      flushCurrent();
      currentRole = userMatch ? 'user' : 'assistant';
      headingLine = i;
      contentStartLine = i + 1;
      contentLines = [];
    } else if (currentRole !== null) {
      contentLines.push(line);
    }
    // Lines before the first heading (frontmatter, # AI Conversation) are skipped.
  }
  flushCurrent();

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user') ?? null;

  return { messages, fullText: text, lastUserMessage };
}

export function extractLastUserSection(text: string): string | null {
  const parsed = parseChatFile(text);
  return parsed.lastUserMessage?.content ?? null;
}

export function appendAssistantResponse(text: string, response: string): string {
  const trimmed = text.trimEnd();
  const separator = trimmed ? '\n\n' : '';
  return `${trimmed}${separator}## Assistant\n\n${response.trim()}\n`;
}

export function replaceAssistantResponse(text: string, response: string): string {
  const parsed = parseChatFile(text);
  const lines = text.split('\n');

  const lastAssistant = [...parsed.messages].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant) {
    return appendAssistantResponse(text, response);
  }

  const newLines = [
    ...lines.slice(0, lastAssistant.contentStartLine),
    ...response.trim().split('\n'),
    ...lines.slice(lastAssistant.contentEndLine + 1),
  ];
  return newLines.join('\n');
}

export function ensureChatFileStructure(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return DEFAULT_CHAT_TEMPLATE;
  }

  // Already has frontmatter — check if body has proper structure
  if (hasFrontmatter(trimmed)) {
    const { body } = parseFrontmatter(trimmed);
    const bodyTrimmed = body.trim();
    if (!bodyTrimmed || /^#+\s+\S/.test(bodyTrimmed)) {
      return text; // body either empty or starts with a heading — valid
    }
    // Frontmatter exists but body is raw text — add structure
    return text.trimEnd() + '\n\n# AI Conversation\n\n## User\n\n';
  }

  // No frontmatter — add it
  if (/^##\s+(User|Assistant)\b/i.test(trimmed)) {
    return mergeFrontmatter(text, { ai_agent: 'auto' });
  }

  // Raw text — full wrap
  return `---\nai_agent: auto\n---\n\n# AI Conversation\n\n## User\n\n${trimmed}\n\n`;
}
