export const rewindSource = 'dsh-message-rewind-inline';

/** A tagged, content-free replacement is not itself a model message. */
export function rewindMarker(event) {
  const message = event?.data?.message;
  const source = message?.source;
  if (event?.type !== 'developer/message' || event.surfaceOp?.op !== 'replace' ||
      source?.kind !== rewindSource || message.content?.length !== 0 ||
      !Number.isSafeInteger(source.fromTurn) || !Number.isSafeInteger(source.throughTurn) ||
      source.fromTurn < 0 || source.throughTurn < source.fromTurn) return;
  return source;
}

export function planInlineRewind(session, messageId) {
  const events = session.snapshotEvents();
  const nodes = [...session.surface.nodes];
  const target = events.find(e => e.type === 'user/message' && e.data.id === messageId);
  const index = target ? nodes.indexOf(target.seq) : -1;
  if (index <= 0 || target.surfaceOp !== 'append' || target.data.source.kind !== 'user') {
    throw new Error('这条消息已不在当前对话分支，无法编辑。');
  }
  const start = events.slice(0, target.seq).findLast(e => e.type === 'turn/start');
  const end = events.slice(target.seq).find(e => e.type === 'turn/end' || e.type === 'turn/start');
  const last = events.findLast(e => e.type === 'turn/start' || e.type === 'turn/end');
  if (!start || end?.type !== 'turn/end' || end.data.turn !== start.data.turn || last?.type !== 'turn/end') {
    throw new Error('请等待这一轮对话结束后再编辑。');
  }
  const direct = events.slice(start.seq, end.seq).filter(e => e.type === 'user/message' && e.data.source.kind === 'user');
  if (direct.length !== 1 || direct[0] !== target || !target.data.content.every(b => b.type === 'text')) {
    throw new Error('只能编辑单条纯文本用户消息。');
  }
  const claimed = events.slice(start.seq, target.seq).find(e =>
    e.type === 'agent/inbox/spliced' && e.data.target === 'next-turn' && e.data.removedCount > 0);
  const alreadyAnswered = events.slice(start.seq, target.seq).some(e =>
    e.type === 'assistant/message' || e.type === 'tool/result' ||
    (e.type === 'agent/inbox/spliced' && e.data.target === 'next-step' && e.data.removedCount > 0));
  if (alreadyAnswered || (!claimed && events.slice(start.seq, target.seq).some(e => e.type === 'request/context'))) {
    throw new Error('暂不支持编辑同轮中途追加的消息。');
  }
  const shadowed = nodes.slice(index);
  // DSH regenerates request configuration, but replacing active tool-registry
  // changes alone might desynchronize the surviving model request series.
  if (shadowed.some(seq => {
    const e = events[seq];
    return e?.type === 'developer/message' && e.data.message.content.some(b =>
      b.type === 'tool-addition' || b.type === 'tool-removal');
  })) throw new Error('旧分支包含工具配置变更，当前不能安全撤回。');
  return { shadowed, fromTurn:start.data.turn, throughTurn:last.data.turn, surface:nodes };
}
