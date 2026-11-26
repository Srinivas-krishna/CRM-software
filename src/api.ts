export type Status = 'Planning' | 'In production' | 'Quality check' | 'Ready to ship' | 'Delivered';
export type MaterialStatus = 'To order' | 'Ordered' | 'Received';
export type Material = { id: string; part_id: string; name: string; supplier: string; quantity: string; unit: string; status: MaterialStatus };
export type Part = { id: string; part_code: string; name: string; customer: string; quantity: number; due_date: string; status: Status; unit_price: string; notes: string; created_at: string; materials: Material[] };
export type PartInput = { partCode: string; name: string; customer: string; quantity: number; dueDate: string; status: Status; unitPrice: number; notes: string; materials: { name: string; supplier: string; quantity: number; unit: string; status: MaterialStatus }[] };
export type Bill = { id: string; bill_number: string; part_id: string; part_code: string; name: string; customer: string; quantity: number; unit_price: string; tax_rate: string; created_at: string };
export type AlertPart = Pick<Part, 'id'|'part_code'|'name'|'customer'|'due_date'|'status'> & { daysRemaining: number };
export type Alerts = { upcoming: AlertPart[]; sent: { id: string; part_id: string; part_code: string; message: string; channel: string; created_at: string }[] };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${url}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } }); }
  catch { throw new Error('Cannot reach the server. Start the API and check your connection.'); }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
export const api = {
  parts: () => request<Part[]>('/parts'),
  createPart: (data: PartInput) => request<{id:string}>('/parts', json('POST',data)),
  updatePart: (id: string, data: PartInput) => request<{id:string}>(`/parts/${id}`, json('PUT',data)),
  deletePart: (id: string) => request<void>(`/parts/${id}`, { method:'DELETE' }),
  updateStatus: (id: string, status: Status) => request<Part>(`/parts/${id}/status`,json('PATCH',{status})),
  updateMaterial: (id: string, materialId: string, status: MaterialStatus) => request<Material>(`/parts/${id}/materials/${materialId}`,json('PATCH',{status})),
  bills: () => request<Bill[]>('/bills'),
  createBill: (id: string, unitPrice: number, taxRate: number) => request<Bill>(`/parts/${id}/bills`,json('POST',{unitPrice,taxRate})),
  alerts: () => request<Alerts>('/alerts'),
  sendAlert: (id: string, channel: 'in-app'|'email') => request('/parts/'+id+'/alerts',json('POST',{channel}))
};
