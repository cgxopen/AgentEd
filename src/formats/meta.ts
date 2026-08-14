import type { AgentedMeta } from './types';

export function createMeta(
  attachmentsCount: number,
  contentHash: string,
  existingMeta?: AgentedMeta | null,
): AgentedMeta {
  const now = new Date().toISOString();
  return {
    agented_version: '0.1.0',
    format: 'structured',
    created_at: existingMeta?.created_at ?? now,
    modified_at: now,
    content_hash: contentHash,
    attachments_count: attachmentsCount,
    embeddings_status: existingMeta?.embeddings_status ?? 'none',
  };
}
