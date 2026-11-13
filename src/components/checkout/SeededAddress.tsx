import { AddressElement } from "@whop/elements-react";
import { useState } from "react";
import type { AddressValue } from "../../lib/checkout/order";

// The seed must not follow later edits: the element would hear every keystroke
// back as an update.
export function SeededAddress(props: {
	mode: "billing" | "shipping";
	seed: AddressValue | null;
	allowedCountries?: string[];
	onChange: (value: AddressValue) => void;
	onError: (message: string) => void;
	onReady?: () => void;
}) {
	const [defaultValues] = useState(() =>
		props.seed ? { address: props.seed.address } : undefined,
	);
	return (
		<AddressElement
			className="ck-address-slot"
			labelMode="floating"
			layout="wrap"
			mode={props.mode}
			name="split"
			allowedCountries={props.allowedCountries}
			defaultValues={defaultValues}
			onChange={props.onChange}
			onError={(event) => props.onError(event.message)}
			onReady={props.onReady}
		/>
	);
}
