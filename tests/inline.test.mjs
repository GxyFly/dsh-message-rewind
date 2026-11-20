import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createInlineRewindHost, parseEdit} from '../src/host.mjs';
import {planInlineRewind, rewindMarker} from '../src/inline.mjs';

const requestId='3b286485-8053-4339-b969-d7fca2c60dde';
const signal=new AbortController().signal;
const user=(id,text)=>({id,role:'user',content:[{type:'text',text}],source:{kind:'user',rpcId:id}});
function populate(session) {
  const append=(type,data)=>session.append(type,data,{surfaceOp:'append'});
  for (const [turn,id,content] of [[1,'input-a','KEEP_A'],[2,'input-b','OLD_USER'],[3,'input-c','OLD_FOLLOWUP']]) {
    session.append('turn/start',{turn}); session.append('step/start',{turn,step:1});
    if (turn === 1) append('system/message',{turn,step:1,message:{id:'system',role:'system',content:[{type:'text',text:'SYSTEM'}],source:{kind:'system-prompt'}}});
    append('user/message',user(id,content));
    append('assistant/message',{turn,step:1,stream:[],message:{id:'answer-'+turn,role:'assistant',content:[{type:'text',text:'ANSWER_'+turn}],source:{kind:'model',provider:'fake',model:'fake'}}});
    session.append('step/end',{turn,step:1}); session.append('turn/end',{turn,reason:{stop:'end-turn'}});
  }
  return session;
}
function command(session, rewind) {
  const headSeq=session.snapshotEvents().at(-1).seq;
  session.append('command/run',{commandId:'edit-test',name:'dsh-rewind-edit',source:{kind:'user'}});
  const followups=[];
  const agent={session,inbox:{nextTurn:[],nextStep:[]},runMaintenance:job=>job(signal),followup(m){
    followups.push(m); this.inbox.nextTurn.push(m);
    session.append('agent/inbox/spliced',{target:'next-turn',start:0,inserted:[m]});
    queueMicrotask(()=>{
      const turn=4, step=1;
      session.append('turn/start',{turn});
      this.inbox.nextTurn.shift();
      session.append('agent/inbox/spliced',{target:'next-turn',start:0,removedCount:1,inserted:[]});
      rewind.preStep({agent:this,turn,step,messages:[m]});
      session.append('step/start',{turn,step});
      rewind.beforeRequest({agent:this,turn,step,signal});
      session.append('user/message',m,{surfaceOp:'append'});
      session.append('step/end',{turn,step});session.append('turn/end',{turn,reason:{stop:'end-turn'}});
    });
  }};
  return {agent,followups,commandId:'edit-test',signal,input:{messageId:'input-b',text:'EDITED_USER',headSeq,requestId}};
}
function inMemorySession() {
  const events=[];
  const nodes=[];
  return {header:{id:'same-session'},surface:{nodes},snapshotEvents:()=>events.slice(),append(type,data,options){
    const seq=events.length;
    const op=options?.surfaceOp;
    if (op==='append') nodes.push(seq);
    if (op?.op==='replace') nodes.splice(nodes.indexOf(op.startSeq),nodes.indexOf(op.endSeq)-nodes.indexOf(op.startSeq)+1,seq);
    events.push({type,seq,data,surfaceOp:op});
  }};
}

test('same-session edit replaces the active suffix and admits one ordinary user input',async()=>{
  const session=populate(inMemorySession());
  const rewind=createInlineRewindHost();
  const req=command(session,rewind);
  await rewind.editInSession(req);
  await rewind.editInSession(req);
  const marker=session.snapshotEvents().find(e=>rewindMarker(e));
  assert.deepEqual(rewindMarker(marker),{kind:'dsh-message-rewind-inline',fromTurn:2,throughTurn:3,requestId});
  assert.equal(req.followups.length,1);
  assert.equal(req.followups[0].content[0].text,'EDITED_USER');
  assert.equal(req.agent.session.header.id,'same-session');
  assert.throws(()=>planInlineRewind(session,'input-b'),/已不在/);
});

test('stale edits and pending input are refused before writing a marker',async()=>{
  const session=populate(inMemorySession());
  const rewind=createInlineRewindHost();
  const req=command(session,rewind);
  req.agent.inbox.nextTurn.push(user('pending','keep pending'));
  await assert.rejects(rewind.editInSession(req),/对话已变化/);
  req.agent.inbox.nextTurn.pop();
  session.append('model/selected',{});
  await assert.rejects(rewind.editInSession(req),/对话已变化/);
  assert.ok(!session.snapshotEvents().some(rewindMarker));
});

test('invalid or empty input is refused',()=>{
  for (const input of ['not json','null',JSON.stringify({text:' ',requestId,messageId:'input-b',headSeq:2})]) {
    assert.throws(()=>parseEdit(input),/无效/);
  }
});

const sessionModule=process.env.DSH_SESSION_MODULE;
test('installed DSH derives the same filtered context after reopening',{skip:!sessionModule},async()=>{
  const {Session}=await import(pathToFileURL(sessionModule).href);
  const session=populate(Session.create('inline-test-session'));
  const rewind=createInlineRewindHost();
  const req=command(session,rewind);
  await rewind.editInSession(req);
  const marker=session.snapshotEvents().find(e=>rewindMarker(e));
  assert.equal(session.deriveEventMessage(marker),null);
  const reopened=Session.create(session.header.id,JSON.parse(JSON.stringify(session.snapshotEvents())),session.header,0);
  for (const instance of [session,reopened]) {
    assert.equal(instance.header.id,'inline-test-session');
    assert.deepEqual(instance.deriveMessages().flatMap(m=>m.content.map(b=>b.text)),['SYSTEM','KEEP_A','ANSWER_1','EDITED_USER']);
  }
});
