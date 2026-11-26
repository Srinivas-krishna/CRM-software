import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import 'dotenv/config';
import { erpRouter } from './erp.js';

test('master links persist, replace atomically, protect references and retain entry order', {skip:process.env.ERP_DB_TEST!=='1'}, async()=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const client=await pool.connect();
  let server;
  try {
    await client.query('BEGIN');
    const transactionClient={
      query:(sql,values)=>client.query(sql==='BEGIN'?'SAVEPOINT master_write':sql==='COMMIT'?'RELEASE SAVEPOINT master_write':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT master_write':sql,values),
      release(){}
    };
    // Every request shares an outer transaction, rolled back after the test.
    const app=express();app.use(express.json());
    app.use(erpRouter({query:(...args)=>client.query(...args),connect:async()=>transactionClient}));
    server=app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const request=async(path,method='GET',body)=>{
      const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
      return {status:response.status,data:response.status===204?null:await response.json()};
    };
    const suffix=Date.now();
    const first=await request('/masters/parts','POST',{part_number:`TEST-${suffix}-Z`,name:'First',unit_price:1});
    const second=await request('/masters/parts','POST',{part_number:`TEST-${suffix}-A`,name:'Second',unit_price:2});
    assert.equal(first.status,201);assert.equal(second.status,201);
    const customer=await request('/masters/customers','POST',{customer_code:`TEST-${suffix}`,name:'Schedule test customer',address:''});
    assert.equal(customer.status,201);
    const voucherBody={entry_date:'2026-11-26',target_month:'2026-12-17',part_id:first.data.id,customer_id:customer.data.id,schedule_qty:3};
    const voucher=await request('/vouchers','POST',voucherBody);
    assert.equal(voucher.status,201);
    const vouchers=await request('/vouchers');
    assert.equal(vouchers.data.find(r=>r.id===voucher.data.id).target_month,'2026-12-17');
    assert.equal((await request('/vouchers','POST',{...voucherBody,target_month:'2026-12'})).status,400);
    assert.equal((await request('/vouchers','POST',{...voucherBody,target_month:'2026-02-30'})).status,400);
    const materialBody={name:`Test material ${suffix}`,description:'',part_ids:[first.data.id,second.data.id]};
    const material=await request('/masters/materials','POST',materialBody);
    assert.equal(material.status,201);
    assert.deepEqual(material.data.part_ids,materialBody.part_ids);
    const supplierBody={name:`Test supplier ${suffix}`,address:'',material_type_ids:[material.data.id]};
    const supplier=await request('/masters/suppliers','POST',supplierBody);
    assert.equal(supplier.status,201);
    const materials=await request('/masters/materials');
    assert.deepEqual(materials.data.find(r=>r.id===material.data.id).part_ids,materialBody.part_ids);
    const suppliers=await request('/masters/suppliers');
    assert.deepEqual(suppliers.data.find(r=>r.id===supplier.data.id).material_type_ids,[material.data.id]);
    const updated=await request('/masters/materials/'+material.data.id,'PUT',{...materialBody,part_ids:[second.data.id]});
    assert.equal(updated.status,200);
    const invalid=await request('/masters/materials/'+material.data.id,'PUT',{...materialBody,name:'Should roll back',part_ids:['9223372036854775807']});
    assert.equal(invalid.status,409);
    const after=await request('/masters/materials');
    assert.equal(after.data.find(r=>r.id===material.data.id).name,materialBody.name);
    assert.deepEqual(after.data.find(r=>r.id===material.data.id).part_ids,[second.data.id]);
    assert.equal((await request('/masters/materials','POST',{...materialBody,part_ids:[]})).status,400);
    const ordered=await request('/masters/parts');
    assert.ok(ordered.data.findIndex(r=>r.id===first.data.id)<ordered.data.findIndex(r=>r.id===second.data.id));
    // A failed DELETE needs its own savepoint to keep the outer test transaction usable.
    await client.query('SAVEPOINT delete_check');
    assert.equal((await request('/masters/parts/'+second.data.id,'DELETE')).status,409);
    await client.query('ROLLBACK TO SAVEPOINT delete_check');
    await client.query('SAVEPOINT delete_material_check');
    assert.equal((await request('/masters/materials/'+material.data.id,'DELETE')).status,409);
    await client.query('ROLLBACK TO SAVEPOINT delete_material_check');
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    await client.query('ROLLBACK');client.release();await pool.end();
  }
});
