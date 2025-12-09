-- Add slug column to products table for SEO-friendly URLs
ALTER TABLE products ADD COLUMN slug VARCHAR(255) NULL AFTER id;

-- Create unique index on slug for fast lookups
CREATE UNIQUE INDEX idx_products_slug ON products(slug);

-- Generate slugs for existing products (format: title-id)
UPDATE products SET slug = CONCAT(
    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        SUBSTRING(title, 1, 50), 
        ' ', '-'), 
        '&', 'and'), 
        '@', 'at'), 
        '#', 'hash'), 
        '$', 'dollar'), 
        '%', 'percent'), 
        '^', ''), 
        '*', ''), 
        '(', ''), 
        ')', '')
    ), '-', id)
) WHERE slug IS NULL;

