import test from 'node:test';
import assert from 'node:assert/strict';
import {planRewind,prepareContent,commitRewind} from '../src/core.mjs';

const event=(type,data={},extra={})=>({type,data,...extra});
const input=(id,text)=>event('user/message',{id,source:{kind:'user'},content:[{type:'text',text}]},{surfaceOp:'append'});
const insert=id=>event('agent/inbox/spliced',{target:'next-turn',start:0,inserted:[{id}]});
const claim=()=>event('agent/inbox/spliced',{target:'next-turn',start:0,removedCount:1,inserted:[]});
const sequence=rows=>rows.map((e,seq)=>({...e,seq,time:seq+1}));
const fixture=()=>sequence([
  event('model/selected'),insert('a'),event('turn/start',{turn:1}),claim(),input('a','FIRST'),
  event('assistant/message',{message:{content:'ANSWER-A'}}),event('turn/end',{turn:1}),
  insert('b'),event('turn/start',{turn:2}),claim(),input('b','SECRET-B'),
  event('compaction/summary',{text:'SECRET-SUMMARY'}),event('tool/result',{message:{content:'SECRET-TOOL'}}),
  event('turn/end',{turn:2}),insert('c'),event('turn/start',{turn:3}),claim(),input('c','SECRET-C'),event('turn/end',{turn:3}),
]);

test('editing B preserves A and excludes B, later tools and later compaction',()=>{
  const events=fixture(), plan=planRewind(events,'b');
  assert.equal(plan.boundary,6);
  const prefix=events.slice(0,plan.boundary+1);
  assert.match(JSON.stringify(prefix),/FIRST/);
  assert.doesNotMatch(JSON.stringify(prefix),/SECRET/);
  assert.equal(plan.headSeq,18);
});
test('first message retains only pre-input configuration',()=>{
  const plan=planRewind(fixture(),'a');assert.equal(plan.boundary,0);
});
test('replayed history produces identical plan',()=>{
  assert.deepEqual(planRewind(JSON.parse(JSON.stringify(fixture())),'b'),planRewind(fixture(),'b'));
});
test('incomplete and missing histories are refused',()=>{
  assert.throws(()=>planRewind(fixture().slice(1),'b'),/完整/);
  assert.throws(()=>planRewind(fixture(),'missing'),/找不到/);
  const gap=fixture();gap[3].seq=55;assert.throws(()=>planRewind(gap,'b'),/连续/);
});
test('attachment editing is refused without discarding the attachment',()=>{
  const events=fixture();events[10].data.content.push({type:'image',attachment:{id:'image'}});
  assert.throws(()=>planRewind(events,'b'),/附件/);
  assert.equal(prepareContent(events[10].data).attachments[0].image.attachment.id,'image');
});
test('mid-turn user steering is refused',()=>{
  const events=fixture();events.splice(11,0,input('steering','new'));
  assert.throws(()=>planRewind(sequence(events),'steering'),/同轮/);
});
test('a queued message cannot cause loss of the previous turn',()=>{
  const events=fixture();const [queued]=events.splice(7,1);events.splice(5,0,queued);
  assert.throws(()=>planRewind(sequence(events),'b'),/排队/);
});
test('failed prompt retries the same child and same request id, including after reload',async()=>{
  const calls=[];let saved,fail=true;
  const api={fork:async()=>{calls.push('fork');return 'child';},save:op=>{saved=structuredClone(op);},prompt:async(child,text,id)=>{calls.push([child,text,id]);if(fail)throw Error('transport lost');}};
  const op={boundary:6,text:'new B',requestId:'unique'};
  await assert.rejects(commitRewind(api,op),/transport/);
  assert.equal(saved.childId,'child');
  fail=false;
  assert.equal(await commitRewind(api,saved),'child');
  assert.deepEqual(calls,['fork',['child','new B','unique'],['child','new B','unique']]);
  await commitRewind(api,saved);assert.equal(calls.length,3);
});
test('fork failure never submits a prompt',async()=>{
  await assert.rejects(commitRewind({fork:async()=>{throw Error('failed');},prompt:()=>assert.fail(),save:()=>assert.fail()},{boundary:0}),/failed/);
});
