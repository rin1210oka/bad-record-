export type ClientBackend=<T>(url:string,method:string,body?:unknown)=>Promise<T>;
let backend:ClientBackend|undefined;
export function installClientBackend(value:ClientBackend){backend=value;}
// Internal operation names; these are not HTTP endpoints.
export function clientRequest<T>(url:string,method='GET',body?:unknown):Promise<T>{
  if(!backend)return Promise.reject(new Error('接続の準備ができていません。画面を再読み込みしてください。'));
  return backend<T>(url,method,body);
}
