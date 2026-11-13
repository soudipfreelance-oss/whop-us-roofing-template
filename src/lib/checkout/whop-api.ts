import type { WhopClient } from "@whop/sdk";

// The server's handlers take Whop's client calls as plain functions, so a kept
// read or a test's stand-in can answer for one. Each call keeps the SDK's own
// request and options, and answers with what the SDK resolves to, narrowed to
// the fields its handler reads: nothing here restates a shape the SDK owns.
export type Call<
	F extends (...args: never[]) => unknown,
	Answer = Awaited<ReturnType<F>>,
> = (...args: Parameters<F>) => PromiseLike<Answer>;

type Variants = WhopClient["variants"];
export type Payments = WhopClient["payments"];
type PaymentQuotes = WhopClient["paymentQuotes"];

export type VariantCall = Variants["retrieve"];
export type WhopVariant = Awaited<ReturnType<Variants["retrieve"]>>;
export type WhopPayment = Awaited<ReturnType<Payments["create"]>>;
export type WhopPaymentStatus = Awaited<ReturnType<Payments["retrieveStatus"]>>;
export type QuoteCall = PaymentQuotes["retrieve"];
export type WhopPaymentQuote = Awaited<ReturnType<PaymentQuotes["retrieve"]>>;
