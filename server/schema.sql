CREATE TABLE IF NOT EXISTS parts (
  id BIGSERIAL PRIMARY KEY,
  part_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  customer TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Planning' CHECK (status IN ('Planning','In production','Quality check','Ready to ship','Delivered')),
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS materials (
  id BIGSERIAL PRIMARY KEY,
  part_id BIGINT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  supplier TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'To order' CHECK (status IN ('To order','Ordered','Received'))
);
CREATE TABLE IF NOT EXISTS bills (
  id BIGSERIAL PRIMARY KEY,
  bill_number TEXT UNIQUE,
  part_id BIGINT NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
  part_code TEXT NOT NULL,
  name TEXT NOT NULL,
  customer TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  part_id BIGINT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in-app','email')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_materials_part ON materials(part_id);
CREATE INDEX IF NOT EXISTS idx_parts_due ON parts(due_date);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
