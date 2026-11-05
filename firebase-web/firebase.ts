import {initializeApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,GoogleAuthProvider} from 'firebase/auth';
import {initializeFirestore,memoryLocalCache,connectFirestoreEmulator} from 'firebase/firestore';

const env=import.meta.env;
export const useEmulators=env.DEV&&env.VITE_USE_FIREBASE_EMULATORS==='true';
const projectId=useEmulators?'demo-shuttle-note':env.VITE_FIREBASE_PROJECT_ID||'';
export const configured=Boolean(projectId&&(env.VITE_FIREBASE_API_KEY||useEmulators)&&(env.VITE_FIREBASE_AUTH_DOMAIN||useEmulators));
const app=initializeApp({projectId:projectId||'not-configured',apiKey:env.VITE_FIREBASE_API_KEY||'not-configured',authDomain:env.VITE_FIREBASE_AUTH_DOMAIN||'localhost',appId:env.VITE_FIREBASE_APP_ID||undefined});
export const auth=getAuth(app);
export const db=initializeFirestore(app,{localCache:memoryLocalCache()});
export const provider=new GoogleAuthProvider();
provider.setCustomParameters({prompt:'select_account'});
if(useEmulators){connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8080);}
