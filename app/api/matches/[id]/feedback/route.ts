import {feedbackRequest} from '../../../../../lib/feedback-http';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Context){const {id}=await params;return feedbackRequest(request,(store,actor)=>store.get(id,actor));}
export async function PUT(request:Request,{params}:Context){const {id}=await params;return feedbackRequest(request,(store,actor,body)=>store.save(id,actor,body));}
export async function DELETE(request:Request,{params}:Context){const {id}=await params;return feedbackRequest(request,(store,actor,body)=>store.remove(id,actor,body));}
