export function accessErrorMessage(error:unknown):string {
  const code=(error as {code?:string})?.code;
  if(code==='auth/popup-closed-by-user'||code==='auth/cancelled-popup-request')return 'Googleログインを中断しました。もう一度お試しください。';
  if(code==='auth/configuration-not-found')return 'Firebase側のログイン設定がまだ済んでいません。保守担当にお知らせください。';
  if(code==='auth/unauthorized-domain')return 'この公開URLのログイン設定がまだ済んでいません。保守担当にお知らせください。';
  if(code==='auth/operation-not-allowed')return 'Googleログインの準備がまだ済んでいません。保守担当にお知らせください。';
  if(code==='auth/popup-blocked')return 'Googleのログイン画面を開けませんでした。ブラウザーでポップアップを許可して、もう一度お試しください。';
  if(code==='permission-denied')return '合言葉が違うか、参加受付が停止されています。確認して、もう一度お試しください。';
  if(code==='auth/network-request-failed'||code==='unavailable')return '接続を確認して、もう一度お試しください。';
  return error instanceof Error?error.message:'処理できませんでした。もう一度お試しください。';
}
