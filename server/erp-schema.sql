-- Additive migration: the original production and billing tables are preserved.
CREATE TABLE IF NOT EXISTS part_masters (
  id BIGSERIAL PRIMARY KEY, part_number VARCHAR(48) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL, unit_price NUMERIC(12,2) NOT NULL CHECK(unit_price >= 0)
);
CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY, customer_code VARCHAR(48) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL, address TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS raw_material_types (
  id BIGSERIAL PRIMARY KEY, name VARCHAR(160) NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY, name VARCHAR(160) NOT NULL UNIQUE,
  material_type_id BIGINT NOT NULL REFERENCES raw_material_types(id) ON DELETE RESTRICT,
  address TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS schedule_vouchers (
  id BIGSERIAL PRIMARY KEY, entry_date DATE NOT NULL, target_month DATE NOT NULL,
  part_id BIGINT NOT NULL REFERENCES part_masters(id) ON DELETE RESTRICT,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  schedule_qty INTEGER NOT NULL CHECK(schedule_qty > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK(unit_price >= 0),
  created_by BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_month ON schedule_vouchers(target_month);

-- Existing installations may still have user attribution; retain it without requiring login.
ALTER TABLE schedule_vouchers ALTER COLUMN created_by DROP NOT NULL;

CREATE TABLE IF NOT EXISTS raw_material_parts (
  material_type_id BIGINT NOT NULL REFERENCES raw_material_types(id) ON DELETE CASCADE,
  part_id BIGINT NOT NULL REFERENCES part_masters(id) ON DELETE RESTRICT,
  PRIMARY KEY (material_type_id, part_id)
);
CREATE TABLE IF NOT EXISTS supplier_material_types (
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  material_type_id BIGINT NOT NULL REFERENCES raw_material_types(id) ON DELETE RESTRICT,
  PRIMARY KEY (supplier_id, material_type_id)
);
-- Preserve the scope of supply already recorded by existing installations.
INSERT INTO supplier_material_types (supplier_id, material_type_id)
SELECT id, material_type_id FROM suppliers ON CONFLICT DO NOTHING;

-- Target dates now retain the day; existing month-only entries retain their saved first day.
ALTER TABLE schedule_vouchers DROP CONSTRAINT IF EXISTS schedule_vouchers_target_month_check;
