# US Roofing Contractor Template on Whop Websites

A production-ready, white-label website template for US roofing companies deployed live on **Whop Websites** (`https://whop.site`).

## Whop Features Implemented

- **White-Label Config (`src/config/roofing.config.ts`):** Swap company name, state contractor license, phone, service areas, reviews, and Whop `plan_` IDs without changing layout structure.
- **Whop Payment Elements (`src/components/RoofingCheckoutModal.tsx`):** Embeds `CheckoutElement` (with Apple Pay / Google Pay express checkout and automatic Klarna, Afterpay, and Splitit BNPL financing) plus the required `BrandingElement` for:
  - **$149** 21-Point Drone & Attic Roof Inspection (`plan_h2DKcSigc9dnf`)
  - **$500** Full Roof Replacement Kickoff Deposit with Card-on-File Setup Intent (`plan_Yf4GLDnLPz6IV`)
  - **$399** Flat-Rate Emergency Leak & Pipe Boot Repair (`plan_P4R2wWUZlFbJW`)
- **Whop Leads API (`src/lib/roofing.fns.ts`):** Captures homeowner estimate requests (`POST /api/v1/leads`) with property address, phone, and service metadata.
- **Whop Invoices API (`src/lib/roofing.fns.ts`):** Issues final project balance invoices (`POST /api/v1/invoices`) via automatic card charging or email payment link.
- **Whop Pixel (`src/routes/__root.tsx`):** Tracks automatic page views plus `service_viewed`, `deposit_started`, and `estimate_requested` conversion events via `whop.track()`.

## Live Deployment & Local Setup

- **Live URL:** https://whop.site
- **Run Locally:** `npm install && npm run dev`
- **Deploy to Whop:** `whop apps deploy`
