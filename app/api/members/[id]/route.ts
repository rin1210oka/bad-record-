import {teamRequest} from '../../../../lib/team-http';
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return teamRequest(request,(store,_actor,body)=>store.writeMember(body,id));}
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return teamRequest(request,(store,_actor,body)=>store.deleteMember(id,body));}
