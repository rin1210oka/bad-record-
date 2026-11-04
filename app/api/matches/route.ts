import {teamRequest} from '../../../lib/team-http';
export async function POST(request:Request){return teamRequest(request,(store,actor,body)=>store.writeMatch(body,actor));}
