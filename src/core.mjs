/** Enter submits; Shift+Enter and input-method confirmation remain native editing actions. */
export function isSendKey(event) {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing
    && !event.nativeEvent?.isComposing && event.keyCode !== 229
    && event.nativeEvent?.keyCode !== 229;
}

/** Prepare the built-in user content factory without losing non-text blocks. */
export function prepareContent(data) {
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const attachments = data.content.flatMap(b => b.type === 'image' && b.attachment
    ? [{type:'image', image:{attachment:b.attachment}}]
    : b.type === 'file' && b.attachment ? [{type:'file', file:b.attachment}] : []);
  return {text, attachments, extraBlocks:data.content.filter(b => !['text','image','file'].includes(b.type)),
    ...(data.referenceLabels ? {referenceLabels:data.referenceLabels} : {})};
}

/** Find a closed, empty-inbox prefix before this input, preserving all earlier user messages. */
export function planRewind(events, messageId) {
  if (!events.length || events[0].seq !== 0) throw new Error('历史尚未加载完整，请重试。');
  for(let i=0;i<events.length;i++) if(events[i].seq !== i) throw new Error('会话历史不连续，已停止撤回。');
  const target = events.find(e => e.type === 'user/message' && e.data.id === messageId && e.surfaceOp === 'append');
  if(!target || target.data.source?.kind !== 'user') throw new Error('找不到可编辑的用户消息。');
  if(target.data.content.some(b => b.type !== 'text')) throw new Error('此版本暂不支持编辑含附件的消息。');
  const start = events.slice(0,target.seq).findLast(e=>e.type === 'turn/start');
  if(!start) throw new Error('找不到消息的轮次边界。');
  const before = events.slice(start.seq,target.seq).filter(e=>e.type === 'user/message' && e.data.source?.kind === 'user');
  if(before.length) throw new Error('此版本暂不支持编辑同轮中途输入的消息。');
  let turnOpen = false;
  let boundary = -1;
  const inbox = {'next-turn':[], 'next-step':[]};
  for(const e of events.slice(0,start.seq)) {
    if(e.type === 'turn/start') turnOpen = true;
    if(e.type === 'turn/end') turnOpen = false;
    if(e.type === 'agent/inbox/spliced') {
      const s=e.data, list=inbox[s.target];
      if(!list || s.start<0 || s.start>list.length || (s.removedCount??0)>list.length-s.start) throw new Error('无法验证历史输入队列。');
      list.splice(s.start,s.removedCount??0,...s.inserted);
    }
    if(!turnOpen && !inbox['next-turn'].length && !inbox['next-step'].length) boundary=e.seq;
  }
  const previousInput = events.slice(0,start.seq).findLast(e=>e.type==='user/message' && e.surfaceOp==='append');
  if(previousInput && previousInput.seq>boundary) throw new Error('该消息曾在运行中排队，暂不能安全保留其前文，请从其他消息重试。');
  return {boundary, targetSeq:target.seq, headSeq:events.at(-1).seq};
}

/** Persist fork progress before prompt admission and reuse the same RPC identity after interruption. */
export async function commitRewind(api, operation) {
  if(operation.accepted) return operation.childId;
  if(!operation.childId) {
    const childId = await api.fork(operation.boundary);
    operation.childId = childId;
    api.save(operation);
  }
  await api.prompt(operation.childId, operation.text, operation.requestId);
  operation.accepted = true;
  api.save(operation);
  return operation.childId;
}
