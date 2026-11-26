import { Router } from 'express';
import { z } from 'zod';

const field = z.string().trim().min(1).max(160);
const id = z.string().regex(/^[1-9]\d*$/);
const address = z.string().trim().max(2000).default('');
const price = z.coerce.number().finite().min(0).max(9999999999.99).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.0001, 'Use at most two decimal places');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(s); return !isNaN(+d) && d.toISOString().slice(0,10) === s; }, 'Invalid date');
const linkedIds = z.array(id).min(1, 'Select at least one associated record').max(1000).transform(ids => [...new Set(ids)]);
const definitions = {
  parts: { table:'part_masters', schema:z.object({ part_number:field.max(48), name:field, unit_price:price }) },
  customers: { table:'customers', schema:z.object({ customer_code:field.max(48), name:field, address }) },
  materials: { table:'raw_material_types', schema:z.object({ name:field, description:address, part_ids:linkedIds }), link:{field:'part_ids',table:'raw_material_parts',owner:'material_type_id',target:'part_id'} },
  suppliers: { table:'suppliers', schema:z.object({ name:field, material_type_ids:linkedIds, address }), link:{field:'material_type_ids',table:'supplier_material_types',owner:'supplier_id',target:'material_type_id'} }
};
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
export function erpRouter(pool) {
  const router = Router();
  for(const [name,def] of Object.entries(definitions)) {
    router.get('/masters/'+name,wrap(async(_req,res)=>{
      const link=def.link;
      const selection=link?`, ARRAY(SELECT l.${link.target}::text FROM ${link.table} l WHERE l.${link.owner}=m.id ORDER BY l.${link.target}) AS ${link.field}`:'';
      res.json((await pool.query(`SELECT m.*${selection} FROM ${def.table} m ORDER BY m.id ASC`)).rows);
    }));
    const saveMaster = updating => wrap(async(req,res)=>{
      const data=def.schema.parse(req.body), recordId=updating?id.parse(req.params.id):null;
      const link=def.link, selections=link?data[link.field]:[];
      if(link) delete data[link.field];
      if(name==='suppliers') data.material_type_id=selections[0];
      const keys=Object.keys(data), client=await pool.connect();
      try {
        await client.query('BEGIN');
        const result=updating
          ?await client.query(`UPDATE ${def.table} SET ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')} WHERE id=$${keys.length+1} RETURNING *`,[...Object.values(data),recordId])
          :await client.query(`INSERT INTO ${def.table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(data));
        if(!result.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Master not found.'});}
        const row=result.rows[0];
        if(link){
          await client.query(`DELETE FROM ${link.table} WHERE ${link.owner}=$1`,[row.id]);
          await client.query(`INSERT INTO ${link.table} (${link.owner},${link.target}) SELECT $1, unnest($2::bigint[])`,[row.id,selections]);
          row[link.field]=selections;
        }
        await client.query('COMMIT');
        res.status(updating?200:201).json(row);
      } catch(error){await client.query('ROLLBACK');throw error;}
      finally{client.release();}
    });
    router.post('/masters/'+name,saveMaster(false));
    router.put('/masters/'+name+'/:id',saveMaster(true));
    router.delete('/masters/'+name+'/:id',wrap(async(req,res)=>{
      const result=await pool.query(`DELETE FROM ${def.table} WHERE id=$1`,[id.parse(req.params.id)]);
      if(!result.rowCount) return res.status(404).json({error:'Master not found.'}); res.status(204).end();
    }));
  }
  router.get('/vouchers',wrap(async(_req,res)=>res.json((await pool.query(`SELECT v.*,to_char(v.entry_date,'YYYY-MM-DD') AS entry_date,to_char(v.target_month,'YYYY-MM-DD') AS target_month,p.part_number,p.name AS part_name,c.customer_code,c.name AS customer_name FROM schedule_vouchers v JOIN part_masters p ON p.id=v.part_id JOIN customers c ON c.id=v.customer_id ORDER BY v.id ASC`)).rows)));
  router.post('/vouchers',wrap(async(req,res)=>{
    const data=z.object({entry_date:date,target_month:date,part_id:id,customer_id:id,schedule_qty:z.coerce.number().int().positive().max(100000000)}).parse(req.body);
    const result=await pool.query(`INSERT INTO schedule_vouchers(entry_date,target_month,part_id,customer_id,schedule_qty,unit_price) SELECT $1,$2,id,$4,$5,unit_price FROM part_masters WHERE id=$3 RETURNING *`,[data.entry_date,data.target_month,data.part_id,data.customer_id,data.schedule_qty]);
    if(!result.rowCount) return res.status(400).json({error:'Select an existing part.'}); res.status(201).json(result.rows[0]);
  }));
  router.use((error,_req,res,next)=>{
    if(error instanceof z.ZodError) return res.status(400).json({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')});
    if(error.code==='23505') return res.status(409).json({error:'This code or name is already in use.'});
    if(error.code==='23503'||error.code==='23001') return res.status(409).json({error:'This record is referenced by another record. Check master selections before saving or deleting.'});
    next(error);
  });
  return router;
}
