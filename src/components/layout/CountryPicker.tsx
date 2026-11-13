import { locationName, otherCountries } from "../../lib/checkout/countries";
import { storeCookies } from "../../lib/checkout/environment";
import { isCountryPick } from "../../lib/checkout/presentment";
import { dropPick, keepPick } from "../../lib/checkout/quote-handover";
import { currentPick } from "../../lib/store-pick";

const YOUR_LOCATION = "";

// The country the store prices for. Until the buyer picks one, prices are in
// their own currency where Whop places their IP, and the picker names the
// country Cloudflare places them in (`buyerCountry`, read by the server so its
// render and the browser's agree). The two rarely disagree; when they do, the
// name and the currency can. A currency picked at checkout shows as itself
// until they pick a country here. A pick reloads the page, so the prices the
// server renders and the quotes the page asks for both follow it.
export function CountryPicker({ buyerCountry }: { buyerCountry?: string }) {
	const pick = currentPick();
	return (
		<select
			aria-label="Country"
			defaultValue={pick ?? YOUR_LOCATION}
			onChange={(event) => {
				const value = event.target.value;
				if (value === YOUR_LOCATION) dropPick(storeCookies);
				else keepPick(storeCookies, value);
				window.location.reload();
			}}
		>
			<option value={YOUR_LOCATION}>{locationName(buyerCountry)}</option>
			{pick && !isCountryPick(pick) ? (
				<option value={pick}>{pick.toUpperCase()}</option>
			) : null}
			{otherCountries(buyerCountry, pick).map(({ code, name }) => (
				<option key={code} value={code}>
					{name}
				</option>
			))}
		</select>
	);
}
