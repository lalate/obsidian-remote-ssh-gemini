/**
 * Vault-relative パスを正規化する。
 * - 二重スラッシュ → 単一スラッシュ
 * - 末尾スラッシュ除去
 * - 先頭スラッシュ除去
 *
 * Obsidian は通常正規化されたパスを渡すが、
 * カスタムプラグインや手動操作で非正規化パスが来る可能性がある。
 */
export function normalizeVaultPath(p: string): string {
  return p
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .replace(/^\//, '');
}
