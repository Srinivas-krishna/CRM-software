import { z } from 'zod';

export const statuses = ['Planning', 'In production', 'Quality check', 'Ready to ship', 'Delivered'];
export const materialStatuses = ['To order', 'Ordered', 'Received'];
const field = z.string().trim().min(1).max(160);
export const materialSchema = z.object({
  name: field, supplier: field, quantity: z.coerce.number().positive().max(100000000),
  unit: field.max(24), status: z.enum(materialStatuses).default('To order')
});
export const partSchema = z.object({
  partCode: field.max(48), name: field, customer: field,
  quantity: z.coerce.number().int().positive().max(100000000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid date'),
  status: z.enum(statuses).default('Planning'), unitPrice: z.coerce.number().min(0).max(100000000),
  notes: z.string().max(2000).default(''), materials: z.array(materialSchema).min(1).max(100)
});
export const billSchema = z.object({ unitPrice: z.coerce.number().min(0).max(100000000), taxRate: z.coerce.number().min(0).max(100) });
export function daysUntil(date, today = new Date()) {
  const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(today);
  const current = Date.parse(`${localDay}T00:00:00Z`);
  return Math.round((Date.parse(`${date}T00:00:00Z`) - current) / 86400000);
}
