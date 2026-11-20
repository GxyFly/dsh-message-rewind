import {commandName, createInlineRewindHost, parseEdit} from './host.mjs';

export const name = 'message-rewind';
export const inject = ['commands'];

export function apply(ctx) {
  const rewind = createInlineRewindHost();
  ctx.on('agent/pre-step', (payload,next) => { rewind.preStep(payload); return next(); }, {prepend:true});
  ctx.on('agent/request', (payload,next) => { rewind.beforeRequest(payload); return next(); }, {prepend:true});
  ctx.on('session/event', rewind.observe);
  ctx.on('agent/inbox/discarded', rewind.discarded);
  ctx.effect(() => ctx.commands.register({
    name: commandName,
    description: 'Edit a historical message in the active conversation',
    recordInput: false,
    async handler({agent, commandId, rawInput, signal}) {
      try {
        await rewind.editInSession({agent, commandId, input:parseEdit(rawInput), signal});
        return {kind:'success', text:''};
      } catch (error) {
        return {kind:'error', text:error instanceof Error ? error.message : String(error)};
      }
    },
  }));
}
