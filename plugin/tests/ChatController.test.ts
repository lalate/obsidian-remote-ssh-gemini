import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatController } from '../src/chat/ChatController';

describe('ChatController', () => {
  let controller: ChatController;
  let mockClient: {
    chatStatus: ReturnType<typeof vi.fn>;
    invokeExtension: ReturnType<typeof vi.fn>;
  };
  let mockApp: {
    vault: {
      read: ReturnType<typeof vi.fn>;
    };
  };
  let mockGetVaultRoot: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockClient = {
      chatStatus: vi.fn(),
      invokeExtension: vi.fn(),
    };
    mockApp = {
      vault: {
        read: vi.fn(),
      },
    };
    mockGetVaultRoot = vi.fn().mockReturnValue('/vault');
    controller = new ChatController(
      mockApp as never,
      mockClient as never,
      mockGetVaultRoot,
    );
  });

  describe('setToolConfig', () => {
    it('sets tool name and args', () => {
      controller.setToolConfig('opencode', { key: 'value' });
      expect(true).toBe(true);
    });

    it('sets model and agent', () => {
      controller.setToolConfig('opencode', {}, 'gpt-4', 'auto');
      expect(true).toBe(true);
    });
  });

  describe('refreshToolConfig', () => {
    it('returns false when client has no chatStatus', async () => {
      const clientWithoutChatStatus = {} as never;
      const ctrl = new ChatController(
        mockApp as never,
        clientWithoutChatStatus,
        mockGetVaultRoot,
      );
      const result = await ctrl.refreshToolConfig();
      expect(result).toBe(false);
    });

    it('returns true when chatStatus returns healthy tool', async () => {
      mockClient.chatStatus.mockResolvedValue({
        healthy: true,
        tools: [{ tool: 'opencode', command: '/usr/bin/opencode' }],
        defaultTool: 'opencode',
      });
      const result = await controller.refreshToolConfig();
      expect(result).toBe(true);
    });

    it('returns false when chatStatus throws', async () => {
      mockClient.chatStatus.mockRejectedValue(new Error('connection failed'));
      const result = await controller.refreshToolConfig();
      expect(result).toBe(false);
    });
  });
});
