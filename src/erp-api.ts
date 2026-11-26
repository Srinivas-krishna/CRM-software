export type RecordRow = { id:string; [key:string]:string|number|string[] };
export async function erp<T>(path:string, method='GET', body?:unknown):Promise<T> {
  let response:Response;
  try { response=await fetch('/api/erp'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}); }
  catch { throw new Error('API unavailable. Start the server and configure DATABASE_URL in .env.'); }
  if(response.status===204) return undefined as T;
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error || 'API unavailable. Check the API terminal and PostgreSQL configuration.');
  return data;
}
