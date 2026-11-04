import {teamRequest} from '../../../../../lib/team-http';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  return teamRequest(request,(store,_actor,body)=>store.restoreMember(id,body));
}
