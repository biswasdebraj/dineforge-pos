ALTER TABLE orders ADD COLUMN delivery_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN packaging_fee_cents INTEGER NOT NULL DEFAULT 0;

INSERT INTO settings (key, value) VALUES
    ('restaurant_address', ''),
    ('gstin', ''),
    ('gst_scheme', 'regular'),
    ('delivery_fee_default_cents', '0'),
    ('packaging_fee_default_cents', '0');
