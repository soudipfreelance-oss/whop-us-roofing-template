# Storefront

A Whop-hosted shop: product and collection pages, a cart, and the checkout and
order-complete pages, on TanStack Start.

## Start a shop

```bash
whop apps init --template storefront --name "My Store" --domain my-store
cd my-store
whop apps dev
```

The storefront reads your products from Whop. Set up the checkout in the
`STORE` blocks of `src/routes/checkout.$planId.tsx` and
`src/routes/order-complete.tsx`, and in `src/lib/checkout/settings.ts`, then
ship it with `whop apps deploy`.
