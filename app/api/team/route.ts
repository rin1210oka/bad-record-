import {teamRequest} from '../../../lib/team-http';
export const dynamic='force-dynamic';
export async function GET(request:Request){return teamRequest(request,(store,actor)=>store.bootstrap(actor));}
