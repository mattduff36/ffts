BEGIN;

-- Remove records created by the reusable template migrations. Exact placeholder
-- markers keep this cleanup from touching Forest-created production records.
DELETE FROM public.customers AS customer
WHERE customer.contact_phone LIKE '01onal 55500_'
  AND NOT EXISTS (
    SELECT 1
    FROM public.quotes AS quote
    WHERE quote.customer_id = customer.id
  );

DELETE FROM public.quote_manager_series
WHERE manager_email LIKE '%@example.com';

COMMIT;
