import {createContext,useContext} from 'react';
import type {ReactNode} from 'react';
export type AccessViewer={id:string;memberId:string|null;name:string};
export const AccessContext=createContext<{viewer:AccessViewer;controls:ReactNode}|null>(null);
export function useAccess(){const context=useContext(AccessContext);if(!context)throw new Error('入場情報を読み込めませんでした。');return context;}
