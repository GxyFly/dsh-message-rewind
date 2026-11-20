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
