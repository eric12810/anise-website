# POS environment and image verification

The website selects its POS origin from the website hostname in `pos-environment.js`. Production hosts (`www.loveanise.co.uk` and `loveanise.co.uk`) select `https://pos.loveanise.co.uk`; staging hosts select `https://pos-staging.loveanise.co.uk`. Unknown hosts fail closed. The thumbnail handler applies the same mapping server-side, so cached thumbnails cannot silently cross environments.

Before the next production release, perform read-only checks against both `/api/menu` endpoints and record product IDs, image URL presence, content type, byte length and SHA-256. For each product ID, compare the production and staging image hashes. Do not submit checkout requests, create orders, invoke Stripe, or copy a database.

If an image exists only in staging, use an image-only migration with an explicit product-ID allowlist: export `(ProductId, Data, ContentType)` from staging, produce a dry-run report with byte counts and hashes, back up production, verify both database identities, and insert/update only the approved `dbo.ProductImages` rows on production. Recheck hashes and `/api/menu/products/{id}/image` responses afterward. Never copy customers, orders, payments, configuration, or a full database, and stop on conflicting product IDs or unresolved environment identity.

The production release guard rejects staging POS references in application files. The two approved environment mapping files (`pos-environment.js` and `dish-thumbnail.ashx`) may contain both mappings by design; runtime host selection is what chooses the destination.
