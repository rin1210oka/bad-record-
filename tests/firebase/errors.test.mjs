import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('firebase-web/errors.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {accessErrorMessage}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('実際に発生したFirebase初期設定エラーは対応がわかる日本語で表示する',()=>{
  const error=Object.assign(new Error('Firebase: Error (auth/configuration-not-found).'),{code:'auth/configuration-not-found'});
  const text=accessErrorMessage(error);assert.match(text,/ログイン設定/);assert.match(text,/保守担当/);assert.ok(!text.includes('auth/configuration-not-found'));
});
