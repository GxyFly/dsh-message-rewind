import { prepareContent, planRewind, commitRewind } from './core.mjs';

export const name = 'message-rewind-client';
export const inject = ['slots', 'sessions', 'uiWorkspace', 'remote', 'remote.session'];

/** Attach a user-message renderer through the public keyed Slot. */
export function apply(ctx) {
  const {createElement:h, useState, useRef, useSyncExternalStore} = require('react');
  const operations = new Map();
  let disposed = false;
  ctx.effect(()=>()=>{disposed=true;});
  const prefix = 'dsh-message-rewind:0.1:';
  const readOperation = key => {
    if(operations.has(key)) return operations.get(key);
    try { const raw=sessionStorage.getItem(prefix+key); if(raw) {const op=JSON.parse(raw); operations.set(key,op);return op;} } catch { /* optional recovery storage */ }
  };
  const saveOperation = (key,op) => {
    operations.set(key,op);
    sessionStorage.setItem(prefix+key,JSON.stringify(op));
  };
  function UserMessage(props) {
    const {node,sessionId,loadImage,renderFactorySlot,renderSlotChain} = props;
    const data=node.data, prepared=prepareContent(data);
    const [editing,setEditing]=useState(false), [text,setText]=useState(prepared.text);
    const [busy,setBusy]=useState(false), [error,setError]=useState(''), [copied,setCopied]=useState(false);
    const locked=useRef(false), currentOperation=useRef(null);
    const binding=ctx.sessions.binding(sessionId);
    const snapshot=useSyncExternalStore(binding.session.subscribe.bind(binding.session),binding.session.getSnapshot.bind(binding.session));
    const unsupported=data.content.some(b=>b.type!=='text');
    const unavailable=unsupported || snapshot.running || snapshot.subagent !== null;
    const hint=unsupported?'此版本暂不支持编辑含附件的消息':snapshot.running?'停止生成后可编辑':'编辑并重新发送';
    async function submit() {
      if(locked.current || !text.trim()) return;
      locked.current=true;setBusy(true);setError('');
      try {
        const previous=readOperation(sessionId+':'+data.messageId);
        if(previous && previous.text===text && previous.childId) currentOperation.current=previous;
        if(!currentOperation.current) {
          if(binding.session.getSnapshot().running) throw new Error('请先停止生成。');
          await binding.session.loadThrough(0);
          if(disposed) return;
          if(binding.session.getSnapshot().running) throw new Error('会话已继续运行，请稍后重试。');
          const events=binding.eventSource.getSnapshot().entries.filter(e=>e.type==='event').map(e=>e.event);
          const plan=planRewind(events,data.messageId);
          const inbox=binding.session.projections.faceOf('inbox').getSnapshot();
          if(!inbox || inbox['next-turn']?.length || inbox['next-step']?.length) throw new Error('输入队列尚未清空，请稍后重试。');
          currentOperation.current={...plan,text,sourceSessionId:sessionId,messageId:data.messageId,requestId:crypto.randomUUID()};
        }
        const op=currentOperation.current;
        if(op.text!==text) throw new Error('上一提交尚未确定结果，请先重试原内容或打开已创建的分支。');
        const key=sessionId+':'+data.messageId;
        const childId=await commitRewind({
          fork: async boundary => {
            if(binding.session.getSnapshot().running) throw new Error('会话已继续运行。');
            const head=binding.eventSource.getSnapshot().entries.filter(e=>e.type==='event').at(-1)?.event.seq;
            if(head!==op.headSeq) throw new Error('历史已变化，请取消编辑后重试。');
            if(boundary<0) throw new Error('此消息之前没有可安全继承的事件。');
            return ctx.sessions.fork({sessionId,atSeq:boundary,allowMigration:false});
          },
          save: value=>saveOperation(key,value),
          prompt: async (child,text,requestId)=>{
            const result=await ctx.remote.session.prompt({sessionId:child,requestId,mode:'queue',content:[{type:'text',text}]});
            if(!result.ok) throw new Error(result.error.message);
          },
        },op);
        if(!disposed) ctx.uiWorkspace.openSession(childId);
      } catch(e) {setError(e instanceof Error?e.message:String(e));}
      finally {locked.current=false;setBusy(false);}
    }
    const icon=(path)=>h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,'aria-hidden':true},h('path',{d:path}));
    const button=(label,action,child,disabled=false)=>h('button',{type:'button',className:'dsh-rw-icon',title:label,'aria-label':label,onClick:action,disabled},child);
    const clock=new Date(data.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    return h('div',{className:'dsh-rw-row','data-rewind-message':data.messageId},
      h('style',null,STYLES),
      renderSlotChain?.('conversation.chat.user.before',{source:data.source,kind:node.kind},{fallback:null}),
      editing ? h('div',{className:'dsh-rw-editor',title:'编辑重发只回退对话上下文，工作区文件保持当前状态。'},
        h('textarea',{'aria-label':'编辑消息',autoFocus:true,value:text,disabled:busy||Boolean(currentOperation.current?.childId),onChange:e=>setText(e.target.value),onKeyDown:e=>{if(e.key==='Escape'&&!busy){setEditing(false);setError('');} if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();submit();}}}),
        error&&h('div',{role:'alert',className:'dsh-rw-error'},error),
        currentOperation.current?.childId&&error&&h('button',{type:'button',className:'dsh-rw-link',onClick:()=>ctx.uiWorkspace.openSession(currentOperation.current.childId)},'打开已创建的分支'),
        h('div',{className:'dsh-rw-buttons'},
          h('button',{type:'button',disabled:busy,onClick:()=>{setEditing(false);setError('');}},'取消'),
          h('button',{type:'button',className:'dsh-rw-send',disabled:busy||!text.trim(),onClick:submit},busy?'发送中…':error&&currentOperation.current?.childId?'重试':'发送')))
      : renderFactorySlot('conversation.chat.user.content',{content:prepared,loadImage,facts:{sessionLabels:data.referenceLabels??[],skillNames:data.skillNames??[]},interactive:true}),
      !editing&&h('div',{className:'dsh-rw-actions'},
        h('span',{className:'dsh-rw-clock'},clock),
        button(copied?'已复制':'复制',async()=>{try{await navigator.clipboard.writeText(prepared.text);setCopied(true);}catch{setError('复制失败。');}},icon(copied?'M5 12l4 4L19 6':'M8 8h12v12H8z M4 16V4h12')),
        button(hint,()=>{currentOperation.current=null;setText(prepared.text);setError('');setEditing(true);},icon('M14 5l5 5 M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16z'),unavailable)),
      !editing&&error&&h('span',{role:'alert',className:'dsh-rw-error'},error));
  }
  ctx.slots.inject('conversation.chat.node',()=>ctx.slots.register({
    name:'conversation.chat.node',key:'user',priority:-50,
    children:{'conversation.chat.user.before':{kind:'chain',scope:'session'}},
  },UserMessage));
}

const STYLES=`
.dsh-rw-row{display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:0}
.dsh-rw-actions{display:flex;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:12px}
.dsh-rw-clock{margin-right:4px}.dsh-rw-icon{display:inline-flex;align-items:center;justify-content:center;width:25px;height:25px;padding:4px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.dsh-rw-icon:hover{background:var(--dsw-alias-bg-hover,rgba(128,128,128,.12));color:var(--dsw-alias-label-primary,#333)}
.dsh-rw-icon:disabled{opacity:.35;cursor:default}.dsh-rw-icon:focus-visible{outline:2px solid #6b9cff;outline-offset:2px}
.dsh-rw-editor{box-sizing:border-box;width:100%;max-width:748px;min-height:100px;border:0;border-radius:20px;padding:10px 12px 12px;background:#f4f4f4;color:#303030}
.dsh-rw-editor textarea{display:block;box-sizing:border-box;width:100%;min-height:44px;max-height:380px;resize:none;border:0;padding:0;background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1.6;outline:none}
.dsh-rw-buttons{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}
.dsh-rw-buttons button{display:inline-flex;align-items:center;justify-content:center;min-height:28px;padding:3px 10px;border:1px solid #e9e9e9;border-radius:10px;background:#fff;color:#303030;cursor:pointer;font:inherit;font-size:13px;line-height:20px}
.dsh-rw-buttons button:hover{background:#fafafa}.dsh-rw-buttons button:focus-visible{outline:2px solid #6b9cff;outline-offset:2px}
.dsh-rw-buttons .dsh-rw-send{background:#202123;border-color:#202123;color:#fff}.dsh-rw-buttons .dsh-rw-send:hover{background:#353638}.dsh-rw-buttons button:disabled{opacity:.5;cursor:default}
@media(prefers-color-scheme:dark){.dsh-rw-editor{background:#303134;color:#ececec}.dsh-rw-buttons button{background:#404145;border-color:#494a4d;color:#ececec}.dsh-rw-buttons button:hover{background:#4b4c50}.dsh-rw-buttons .dsh-rw-send{background:#ececec;border-color:#ececec;color:#202123}.dsh-rw-buttons .dsh-rw-send:hover{background:#fff}}
.dsh-rw-error{font-size:12px;color:#c53a3a;margin-top:6px}.dsh-rw-link{border:0;background:none;color:#1769e0;cursor:pointer;font:inherit;font-size:12px;padding:6px 0}
`;
