'use strict';

// The backend data stream and model receipt can arrive in either order. Only the
// receipt's trusted turn context decides which conversation owns the data.
function createCanvasDeliveryRouter({ deliver, now = Date.now }) {
  const pending = new Map();
  const validId = (id) => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
  function entry(id) {
    const time = now();
    for (const [key, value] of pending) {
      if (time - value.createdAt > 300_000) pending.delete(key);
    }
    if (!pending.has(id)) {
      if (pending.size >= 256) pending.delete(pending.keys().next().value);
      pending.set(id, { createdAt: time });
    }
    return pending.get(id);
  }
  function flush(value) {
    if (value.delivered || !value.envelope || !value.metadata) return;
    value.delivered = true;
    const envelope = value.envelope;
    delete value.envelope;
    deliver({ status: envelope.fell_back ? 'fallback' : 'success', envelope }, value.metadata);
  }
  return {
    receiveEnvelope(envelope) {
      if (!envelope || !validId(envelope.delivery_id)) return false;
      const value = entry(envelope.delivery_id);
      if (!value.delivered) value.envelope = envelope;
      flush(value);
      return true;
    },
    receiveReceipt(receipt, metadata) {
      if (!receipt || !validId(receipt.delivery_id) || !metadata?.conversationId) return false;
      const value = entry(receipt.delivery_id);
      // Duplicate receipts cannot change an already established owner.
      if (!value.metadata) value.metadata = metadata;
      flush(value);
      return true;
    },
  };
}

module.exports = { createCanvasDeliveryRouter };
