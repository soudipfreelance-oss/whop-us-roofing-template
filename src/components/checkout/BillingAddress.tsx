import { useEffect, useState } from "react";
import type { AddressValue } from "../../lib/checkout/order";
import { SeededAddress } from "./SeededAddress";

// It clips only while opening, so the street-address suggestions can hang below
// it afterwards.
export function BillingAddress(props: {
	seed: AddressValue | null;
	onChange: (value: AddressValue) => void;
	onError: (message: string) => void;
}) {
	const [state, setState] = useState<"loading" | "opening" | "open">("loading");
	// Clipping ends when the 120ms unfold in styles.ts does; with reduced motion there is no unfold, only this wait.
	useEffect(() => {
		if (state !== "opening") return;
		const timer = setTimeout(() => setState("open"), 120);
		return () => clearTimeout(timer);
	}, [state]);
	return (
		<div className={`ck-billing-reveal is-${state}`}>
			<div className="ck-billing-fields">
				<SeededAddress
					mode="billing"
					seed={props.seed}
					onChange={props.onChange}
					onError={props.onError}
					onReady={() =>
						setState((current) => (current === "loading" ? "opening" : current))
					}
				/>
			</div>
		</div>
	);
}
