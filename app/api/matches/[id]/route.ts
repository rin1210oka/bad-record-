import {teamRequest} from '../../../../lib/team-http';
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return teamRequest(request,(store,actor,body)=>store.writeMatch(body,actor,id));}
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return teamRequest(request,(store,actor,body)=>store.deleteMatch(id,body,actor));}
