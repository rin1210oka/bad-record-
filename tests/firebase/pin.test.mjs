import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const values=new Map();
globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
const code=ts.transpileModule(fs.readFileSync('firebase-web/pin.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const pin=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('端末PINは先頭ゼロを保持し、別UID・不正入力・壊れた保存情報では解除しない',async()=>{
  await pin.setDevicePin('a','0123');assert.equal(await pin.verifyDevicePin('a','0123'),true);assert.equal(await pin.verifyDevicePin('a','1230'),false);assert.equal(await pin.verifyDevicePin('b','0123'),false);
  for(const value of ['123','12345','１２３４',1234])await assert.rejects(pin.setDevicePin('a',value));
  assert.notEqual(JSON.parse(values.get('shuttle-note:device-pin:v1:a')).value,'0123');
  values.set('shuttle-note:device-pin:v1:a','broken');assert.equal(await pin.verifyDevicePin('a','0123'),false);
});
