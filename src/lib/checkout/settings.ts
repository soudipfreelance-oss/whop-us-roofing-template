import { fnv1a } from "./shared";

// Fill in per store. The one place for these: the checkout, product pages and
// the server all read them here.
export const CHECKOUT_SETTINGS = {
	shipCountries: ["US", "CA", "GB", "AU", "NZ"],
	// Whop's API doesn't expose a seller's "require terms agreement" setting, so
	// it is set here. A wallet sheet has no terms box, so product pages then show
	// no wallet buttons.
	requireTermsAgreement: false,
	adaptivePricing: true,
};

// The shipping countries as every reader takes them, written however the
// settings spell them (`"us"`, `" CA"`).
export function shipCountries(): string[] {
	return [
		...new Set(
			CHECKOUT_SETTINGS.shipCountries.map((country) =>
				country.trim().toUpperCase(),
			),
		),
	];
}

export function shipsTo(
	country: string | undefined,
	countries: readonly string[],
): boolean {
	const code = (country ?? "").trim().toUpperCase();
	return Boolean(code) && countries.includes(code);
}

// The page sends this with each server call that reads these settings, and the
// server answers one from a page built under other settings (a redeploy since
// it loaded) with `store_updated`, never acting on settings it no longer
// has. The page and the server compile this same object, so its text, keys in
// the order written, is the same on both sides for the same settings.
const SETTINGS_FINGERPRINT = fnv1a(JSON.stringify(CHECKOUT_SETTINGS))
	.toString(16)
	.padStart(8, "0");

export function settingsFingerprint(): string {
	return SETTINGS_FINGERPRINT;
}
