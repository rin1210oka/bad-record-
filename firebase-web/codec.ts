// Firestore does not accept arrays nested directly in arrays. Keep the UI/domain
// score format intact and encode only at the storage boundary.
export function encodeScores(scores:number[][]){return scores.map(([a,b])=>`${a}:${b}`);}
export function decodeScores(scores:string[]){return scores.map(value=>value.split(':').map(Number));}
export function encodeMatch<T extends {scores:number[][]}>(row:T){return {...row,scores:encodeScores(row.scores)};}
export function decodeMatch(row:Record<string,any>):Record<string,any>&{scores:number[][]}{return {...row,scores:decodeScores(row.scores)};}
