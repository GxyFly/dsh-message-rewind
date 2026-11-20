import {randomUUID} from 'node:crypto';
import {planInlineRewind, rewindMarker, rewindSource} from './inline.mjs';

export const commandName = 'dsh-rewind-edit';

export function parseEdit(raw) {
  let input;
  try { input = JSON.parse(raw); } catch { throw new Error('无效的编辑请求。'); }
  if (typeof input?.text !== 'string' || !input.text.trim() ||
      typeof input.messageId !== 'string' || !input.messageId ||
      typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId) ||
      !Number.isSafeInteger(input.headSeq) || input.headSeq < 0) throw new Error('无效的编辑请求。');
  return input;
}

export function createInlineRewindHost() {
  const pending = new WeakMap();
  const settle = (session, job, error) => {
    pending.delete(session);
    job.completion.resolve(error);
  };
  function preStep({agent, turn, step, messages}) {
    const job = pending.get(agent.session);
    if (job && turn === job.plan.throughTurn + 1 && step === 1) {
      job.claimed = messages.some(message => message.id === job.message.id);
    }
  }
  function beforeRequest({agent, turn, step, signal}) {
    const session = agent.session;
    const job = pending.get(session);
    if (!job || turn !== job.plan.throughTurn + 1 || step !== 1) return;
    try {
      signal.throwIfAborted();
      if (!job.claimed) throw new Error('编辑后的消息未进入当前轮次，未执行撤回。');
      const nodes = session.surface.nodes;
      const start = nodes.indexOf(job.plan.shadowed[0]);
      const sameSurface = nodes.length === job.plan.surface.length && nodes.every((seq, i) => seq === job.plan.surface[i]);
      if (start < 1 || !sameSurface) throw new Error('准备发送期间上下文已变化，未执行撤回。');
      // The on-disk format requires this content-free event to belong to an open step.
      session.append('developer/message', {
        turn, step, message: {id:randomUUID(), role:'developer', content:[], source:{kind:rewindSource,
          fromTurn:job.plan.fromTurn, throughTurn:job.plan.throughTurn, requestId:job.requestId}},
      }, {surfaceOp:{op:'replace',startSeq:job.plan.shadowed[0],endSeq:job.plan.shadowed.at(-1)},sourceEventSeqs:job.plan.shadowed});
      settle(session,job);
    } catch (error) {
      settle(session,job,error);
      throw error;
    }
  }
  function observe(session, event) {
    const job = pending.get(session);
    if (job && event.type === 'turn/end' && event.data.turn >= job.plan.throughTurn + 1) {
      settle(session,job,new Error('未能启动编辑后的消息，原对话未回退。'));
    }
  }
  function discarded({agent,message}) {
    const job = pending.get(agent.session);
    if (job?.message.id === message.id) settle(agent.session,job,new Error('已取消编辑重发，原对话未回退。'));
  }
  async function editInSession({agent, commandId, input, signal}) {
    const session = agent.session;
    if (session.header.origin === 'subagent' || session.header.delegationDepth > 0) {
      throw new Error('子会话不支持原地编辑。');
    }
    if (typeof agent.runMaintenance !== 'function' || typeof session.snapshotEvents !== 'function' ||
        typeof agent.followup !== 'function' || !Array.isArray(session.surface?.nodes)) {
      throw new Error('当前版本的 DSH 不支持原地编辑。');
    }
    let completion;
    await agent.runMaintenance(async maintenanceSignal => {
      signal.throwIfAborted();
      maintenanceSignal.throwIfAborted();
      const events = session.snapshotEvents();
      const receipt = events.find(e => rewindMarker(e)?.requestId === input.requestId);
      if (receipt) return;
      const suffix = events.slice(input.headSeq + 1);
      if (pending.has(session) || agent.inbox.nextTurn.length || agent.inbox.nextStep.length ||
          suffix.length !== 1 || suffix[0].type !== 'command/run' || suffix[0].data.commandId !== commandId) {
        throw new Error('对话已变化或还有待发送消息，请稍后重新编辑。');
      }
      const plan = planInlineRewind(session, input.messageId);
      const message = {id:randomUUID(), role:'user', content:[{type:'text',text:input.text}],
        source:{kind:'user',rpcId:input.requestId}};
      completion = Promise.withResolvers();
      const job = {plan,message,requestId:input.requestId,completion,claimed:false};
      pending.set(session,job);
      try { agent.followup(message); } catch (error) { settle(session,job,error); }
    });
    if (completion) {
      const error = await completion.promise;
      if (error) throw error;
    }
  }
  return {editInSession,preStep,beforeRequest,observe,discarded};
}
