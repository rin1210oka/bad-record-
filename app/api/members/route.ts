import {teamRequest} from '../../../lib/team-http';
export async function POST(request:Request){return teamRequest(request,(store,_actor,body)=>store.writeMember(body));}
