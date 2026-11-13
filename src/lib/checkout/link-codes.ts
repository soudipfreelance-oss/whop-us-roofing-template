import type { AttemptStorage } from "./charge-attempt";
import { type LinkInputs, linkInputsOf } from "./order";
import { isRecord } from "./shared";
import { readStored, writeStored } from "./stored";

// A buyer who lands on the store through a link keeps its codes for the tab's
// session: a cart checkout, whose own address carries none, and the product
// page's wallets honor the same ones. A page whose own address carries a code
// uses its own.
const LINK_CODES_KEY = "storefront-link-codes";
const DROPPED_KEPT = 20;

// `dropped` are promo codes the buyer took off: no later checkout in the tab
// applies one again, from the kept codes or from its own address. `refused`
// are codes Whop refused or left out for one order (its key, `orderKeyOf`):
// only that order skips them, and the link's code still goes with any other.
type RefusedCode = { order: string; code: string };
type KeptCodes = {
	codes: LinkInputs;
	dropped: string[];
	refused: RefusedCode[];
};

const NONE_KEPT: KeptCodes = { codes: {}, dropped: [], refused: [] };

function isRefusedCode(value: unknown): value is RefusedCode {
	return (
		isRecord(value) &&
		typeof value.order === "string" &&
		typeof value.code === "string"
	);
}

function keptCodes(storage: () => AttemptStorage): KeptCodes {
	return readStored(
		storage,
		LINK_CODES_KEY,
		(value): KeptCodes => {
			if (!isRecord(value)) return NONE_KEPT;
			const dropped = Array.isArray(value.dropped)
				? value.dropped.filter(
						(code): code is string => typeof code === "string",
					)
				: [];
			const refused = Array.isArray(value.refused)
				? value.refused.filter(isRefusedCode)
				: [];
			return {
				codes: linkInputsOf({
					promoCode: value.promoCode,
					a: value.affiliateCode,
				}),
				dropped,
				refused,
			};
		},
		NONE_KEPT,
	);
}

// Storage can be off; the page then uses only its own address's codes.
function writeKept(kept: KeptCodes, storage: () => AttemptStorage) {
	writeStored(storage, LINK_CODES_KEY, {
		...kept.codes,
		dropped: kept.dropped.slice(-DROPPED_KEPT),
		refused: kept.refused.slice(-DROPPED_KEPT),
	});
}

function ownCodes(
	search: Record<string, unknown>,
	dropped: readonly string[],
): LinkInputs {
	const own = linkInputsOf(search);
	const usable = own.promoCode && !dropped.includes(own.promoCode);
	return usable ? own : { affiliateCode: own.affiliateCode };
}

export function keepLinkCodes(
	search: Record<string, unknown>,
	storage: () => AttemptStorage,
): void {
	const kept = keptCodes(storage);
	const { promoCode, affiliateCode } = ownCodes(search, kept.dropped);
	if (!promoCode && !affiliateCode) return;
	writeKept(
		{
			codes: {
				promoCode: promoCode ?? kept.codes.promoCode,
				affiliateCode: affiliateCode ?? kept.codes.affiliateCode,
			},
			dropped: kept.dropped,
			refused: kept.refused,
		},
		storage,
	);
}

export function landingLinkInputs(
	search: Record<string, unknown>,
	storage: () => AttemptStorage,
	order: string,
): LinkInputs {
	const { codes, dropped, refused } = keptCodes(storage);
	const skipped = [
		...dropped,
		...refused.flatMap((entry) => (entry.order === order ? entry.code : [])),
	];
	const own = ownCodes(search, skipped);
	const kept =
		codes.promoCode && !skipped.includes(codes.promoCode)
			? codes.promoCode
			: undefined;
	return {
		promoCode: own.promoCode ?? kept,
		affiliateCode: own.affiliateCode ?? codes.affiliateCode,
	};
}

export function refuseLinkPromo(
	code: string,
	order: string,
	storage: () => AttemptStorage,
): void {
	const kept = keptCodes(storage);
	if (
		kept.refused.some((entry) => entry.order === order && entry.code === code)
	) {
		return;
	}
	writeKept({ ...kept, refused: [...kept.refused, { order, code }] }, storage);
}

export function forgetLinkPromo(
	code: string,
	storage: () => AttemptStorage,
): void {
	const kept = keptCodes(storage);
	writeKept(
		{
			codes: {
				promoCode:
					kept.codes.promoCode === code ? undefined : kept.codes.promoCode,
				affiliateCode: kept.codes.affiliateCode,
			},
			dropped: kept.dropped.includes(code)
				? kept.dropped
				: [...kept.dropped, code],
			refused: kept.refused,
		},
		storage,
	);
}
