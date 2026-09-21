'use strict';

// MCP aliases are tool selections, not issuer names. Keep the model's original
// prompt intact and remove only registered mentions from the routing copy.
function stripKnownMcpMentions(question, aliases) {
  const original = String(question || '');
  const known = new Set(aliases || []);
  if (!known.size) return original;
  let text = original.replace(
    /\n\n\(사용자가 지정한 플러그인: (@[A-Za-z0-9_-]+(?:, @[A-Za-z0-9_-]+)*) — 이 MCP 서버의 도구를 우선 사용해 답하라\.\)$/u,
    (annotation, mentions) => mentions.split(', ').every((mention) => known.has(mention.slice(1))) ? '' : annotation,
  );
  text = text.replace(/(^|[\s(])@([A-Za-z0-9_-]+)(?=$|[\s),.!?;:])/gu,
    (mention, prefix, alias) => known.has(alias) ? prefix : mention);
  return text === original ? original : text.trim();
}

module.exports = { stripKnownMcpMentions };
