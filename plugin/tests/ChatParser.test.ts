import { describe, it, expect } from 'vitest';
import {
  hasFrontmatter,
  parseFrontmatter,
  renderFrontmatter,
  mergeFrontmatter,
  parseChatFile,
  extractLastUserSection,
  appendAssistantResponse,
  replaceAssistantResponse,
  ensureChatFileStructure,
  type FrontmatterMeta,
} from '../src/chat/ChatParser';

describe('hasFrontmatter', () => {
  it('returns true for text starting with ---', () => {
    expect(hasFrontmatter('---\nkey: value\n---\nbody')).toBe(true);
  });

  it('returns false for text without frontmatter', () => {
    expect(hasFrontmatter('# Title\nbody')).toBe(false);
  });
});

describe('parseFrontmatter', () => {
  it('parses simple frontmatter', () => {
    const text = '---\nai_session: abc123\nai_model: gpt-4\n---\nbody';
    const { block, body, meta } = parseFrontmatter(text);
    expect(block).toContain('---');
    expect(body).toBe('body');
    expect(meta.ai_session).toBe('abc123');
    expect(meta.ai_model).toBe('gpt-4');
  });

  it('parses provider-specific fields', () => {
    const text = '---\nai_session: uuid123\nai_opencode_session: opencode456\n---\nbody';
    const { meta } = parseFrontmatter(text);
    expect(meta.ai_session).toBe('uuid123');
    expect(meta.ai_opencode_session).toBe('opencode456');
  });

  it('handles quoted values', () => {
    const text = '---\nai_model: "gpt-4"\n---\nbody';
    const { meta } = parseFrontmatter(text);
    expect(meta.ai_model).toBe('gpt-4');
  });
});

describe('renderFrontmatter', () => {
  it('renders meta into YAML block', () => {
    const meta: FrontmatterMeta = {
      ai_session: 'abc123',
      ai_model: 'gpt-4',
    };
    const result = renderFrontmatter(meta);
    expect(result).toContain('---');
    expect(result).toContain('ai_session: abc123');
    expect(result).toContain('ai_model: gpt-4');
  });

  it('skips empty values', () => {
    const meta: FrontmatterMeta = {
      ai_session: 'abc123',
      ai_model: undefined,
    };
    const result = renderFrontmatter(meta);
    expect(result).toContain('ai_session: abc123');
    expect(result).not.toContain('ai_model');
  });

  it('quotes values with special chars', () => {
    const meta: FrontmatterMeta = {
      ai_model: 'model:with:colons',
    };
    const result = renderFrontmatter(meta);
    expect(result).toContain('ai_model: "model:with:colons"');
  });
});

describe('mergeFrontmatter', () => {
  it('adds frontmatter to text without it', () => {
    const text = '# Title\nbody';
    const updates: FrontmatterMeta = { ai_session: 'abc123' };
    const result = mergeFrontmatter(text, updates);
    expect(result).toContain('---');
    expect(result).toContain('ai_session: abc123');
    expect(result).toContain('# Title');
  });

  it('preserves existing fields when merging', () => {
    const text = '---\nai_session: old123\nai_agent: auto\n---\nbody';
    const updates: FrontmatterMeta = { ai_model: 'gpt-4' };
    const result = mergeFrontmatter(text, updates);
    expect(result).toContain('ai_session: old123');
    expect(result).toContain('ai_agent: auto');
    expect(result).toContain('ai_model: gpt-4');
  });

  it('overwrites existing fields', () => {
    const text = '---\nai_session: old123\n---\nbody';
    const updates: FrontmatterMeta = { ai_session: 'new456' };
    const result = mergeFrontmatter(text, updates);
    expect(result).toContain('ai_session: new456');
    expect(result).not.toContain('ai_session: old123');
  });

  it('handles provider-specific session fields', () => {
    const text = '---\nai_session: uuid123\n---\nbody';
    const updates: FrontmatterMeta = { ai_opencode_session: 'opencode789' };
    const result = mergeFrontmatter(text, updates);
    expect(result).toContain('ai_session: uuid123');
    expect(result).toContain('ai_opencode_session: opencode789');
  });
});

describe('parseChatFile', () => {
  it('parses user and assistant messages', () => {
    const text = `---
ai_session: abc123
---

# AI Conversation

## User

Hello

## Assistant

Hi there

## User

How are you?`;
    const parsed = parseChatFile(text);
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[0].role).toBe('user');
    expect(parsed.messages[0].content).toContain('Hello');
    expect(parsed.messages[1].role).toBe('assistant');
    expect(parsed.messages[2].role).toBe('user');
  });
});

describe('extractLastUserSection', () => {
  it('extracts last user message', () => {
    const text = `## User

First message

## Assistant

Response

## User

Second message`;
    const result = extractLastUserSection(text);
    expect(result).toContain('Second message');
  });

  it('skips empty user sections', () => {
    const text = `## User

Real message

## Assistant

Response

## User

`;
    const result = extractLastUserSection(text);
    expect(result).toContain('Real message');
  });
});

describe('appendAssistantResponse', () => {
  it('appends assistant response to text', () => {
    const text = '## User\n\nHello\n';
    const result = appendAssistantResponse(text, 'Hi there');
    expect(result).toContain('## Assistant');
    expect(result).toContain('Hi there');
  });
});

describe('replaceAssistantResponse', () => {
  it('replaces last assistant response', () => {
    const text = `## User

Hello

## Assistant

Old response

## User

Follow-up`;
    const result = replaceAssistantResponse(text, 'New response');
    expect(result).toContain('New response');
    expect(result).not.toContain('Old response');
  });
});

describe('ensureChatFileStructure', () => {
  it('returns default template for empty text', () => {
    const result = ensureChatFileStructure('');
    expect(result).toContain('---');
    expect(result).toContain('ai_agent: auto');
    expect(result).toContain('## User');
  });

  it('adds frontmatter to text without it', () => {
    const text = 'Hello';
    const result = ensureChatFileStructure(text);
    expect(result).toContain('---');
    expect(result).toContain('ai_agent: auto');
  });
});
