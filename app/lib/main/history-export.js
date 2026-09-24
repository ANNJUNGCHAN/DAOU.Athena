'use strict';

// Preserve each store independently: source message IDs and branch topology
// differ, so content-based deduplication would lose legitimate repeated turns.
async function collectHistoryExport({ bridge, fetchBrainJson, limit, now = () => new Date().toISOString() }) {
  const local = { status: 'complete', conversations: [], error: null };
  const brain = { status: 'complete', conversations: [], error: null, truncated: false };
  try {
    if (!bridge) throw new Error('로컬 대화 저장소를 열지 못했습니다.');
    const rows = bridge.store.listSessions({ includeArchived: true, limit: 2147483647 });
    for (const row of rows) {
      try {
        bridge.flush(row.id, { strict: true });
      } catch (error) {
        local.status = 'partial';
        local.error = String(error.message || error);
      }
      const saved = bridge.load(row.id);
      if (!saved) throw new Error('로컬 대화를 읽지 못했습니다.');
      if (!saved.messages.length) continue;
      const { id, title, mode, projectId, archived, createdAt, updatedAt, currentId, messages } = saved;
      local.conversations.push({ id, title, mode, projectId, archived, createdAt, updatedAt, currentId, messages });
    }
  } catch (error) {
    local.status = local.conversations.length ? 'partial' : 'unavailable';
    local.error = String(error.message || error);
  }
  try {
    const listed = await fetchBrainJson('/api/v1/brain/conversations', { params: { limit } });
    if (!listed.ok) throw new Error(listed.error || '브레인 이력을 읽지 못했습니다.');
    const summaries = listed.body && listed.body.conversations || [];
    brain.truncated = summaries.length >= limit;
    for (const summary of summaries) {
      const chats = await fetchBrainJson('/api/v1/brain/chats', {
        params: { conversation_id: summary.conversation_id, limit },
      });
      if (!chats.ok) throw new Error(chats.error || '브레인 대화를 읽지 못했습니다.');
      const messages = chats.body && chats.body.messages || [];
      if (messages.length < summary.message_count) brain.truncated = true;
      brain.conversations.push({ ...summary, messages });
    }
    if (brain.truncated) brain.status = 'partial';
  } catch (error) {
    brain.status = brain.conversations.length ? 'partial' : 'unavailable';
    brain.error = String(error.message || error);
  }
  const counts = {
    localConversations: local.conversations.length,
    localMessages: local.conversations.reduce((n, item) => n + item.messages.length, 0),
    brainConversations: brain.conversations.length,
    brainMessages: brain.conversations.reduce((n, item) => n + item.messages.length, 0),
    uniqueConversations: new Set([...local.conversations.map(item => item.id), ...brain.conversations.map(item => item.conversation_id)]).size,
  };
  const partial = local.status !== 'complete' || brain.status !== 'complete';
  return { schemaVersion: 2, exportedAt: now(), sources: { local, brain }, counts, partial };
}

module.exports = { collectHistoryExport };
