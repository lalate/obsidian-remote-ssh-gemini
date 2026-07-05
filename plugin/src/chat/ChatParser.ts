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

const USER_HEADING = /^##\s+User\s*$/i;
const ASSISTANT_HEADING = /^##\s+Assistant\s*$/i;

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
    return '## User\n\n\n## Assistant\n\n';
  }
  if (/^##\s+(User|Assistant)\b/i.test(trimmed)) {
    return text;
  }
  return `## User\n\n${trimmed}\n\n## Assistant\n\n`;
}