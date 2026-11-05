const prefix='shuttle-note:device-pin:v1:';
const iterations=210000;
function hex(bytes:Uint8Array){return Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');}
async function derive(pin:string,salt:Uint8Array){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:salt as Uint8Array<ArrayBuffer>,iterations,hash:'SHA-256'},key,256)));
}
export function hasDevicePin(uid:string){return localStorage.getItem(prefix+uid)!==null;}
export async function setDevicePin(uid:string,pin:string){
  if(typeof pin!=='string'||!/^\d{4}$/.test(pin))throw new Error('数字4桁で入力してください。');
  const salt=crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(prefix+uid,JSON.stringify({salt:Array.from(salt),value:await derive(pin,salt)}));
}
export async function verifyDevicePin(uid:string,pin:string){
  if(typeof pin!=='string'||!/^\d{4}$/.test(pin))return false;
  try{const stored=JSON.parse(localStorage.getItem(prefix+uid)||'null');if(!stored||!Array.isArray(stored.salt)||stored.salt.length!==16)return false;
    const actual=await derive(pin,new Uint8Array(stored.salt));return actual===stored.value;
  }catch{return false;}
}
