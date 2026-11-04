import {feedbackRequest} from '../../../lib/feedback-http';
export const dynamic='force-dynamic';
export async function GET(request:Request){return feedbackRequest(request,(store,actor)=>store.list(actor));}
