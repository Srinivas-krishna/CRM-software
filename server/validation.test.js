import test from 'node:test';
import assert from 'node:assert/strict';
import { partSchema, daysUntil } from './validation.js';

test('part requires positive quantities and at least one material', () => {
  const base = { partCode:'BR-01', name:'Brake rotor', customer:'Aster', quantity:20, dueDate:'2026-12-10', unitPrice:100, materials:[{name:'Steel',supplier:'Acme',quantity:2,unit:'kg'}] };
  assert.equal(partSchema.safeParse(base).success, true);
  assert.equal(partSchema.safeParse({...base, quantity:0}).success, false);
  assert.equal(partSchema.safeParse({...base, materials:[]}).success, false);
});
test('delivery day calculation handles overdue and upcoming dates', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  assert.equal(daysUntil('2026-11-28', now), 3);
  assert.equal(daysUntil('2026-11-24', now), -1);
});
