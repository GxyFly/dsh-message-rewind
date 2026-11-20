import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareContent,isSendKey} from '../src/core.mjs';

test('Enter sends and Shift+Enter preserves a native newline',()=>{
  assert.equal(isSendKey({key:'Enter'}),true);
  assert.equal(isSendKey({key:'Enter',shiftKey:true}),false);
  assert.equal(isSendKey({key:'Escape'}),false);
});
test('IME Enter never submits while selecting or confirming composed text',()=>{
  assert.equal(isSendKey({key:'Enter',isComposing:true}),false);
  assert.equal(isSendKey({key:'Enter',nativeEvent:{isComposing:true}}),false);
  assert.equal(isSendKey({key:'Enter',keyCode:229}),false);
  assert.equal(isSendKey({key:'Enter',nativeEvent:{keyCode:229}}),false);
});

test('non-text content remains available to the native renderer',()=>{
  const rendered=prepareContent({content:[{type:'text',text:'with image'},{type:'image',attachment:{id:'image'}}]});
  assert.equal(rendered.text,'with image');
  assert.equal(rendered.attachments[0].image.attachment.id,'image');
});
