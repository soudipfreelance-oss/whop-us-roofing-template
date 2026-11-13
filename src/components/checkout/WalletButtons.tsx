import type { WalletButtonArt } from "@whop/elements/payments";
import { walletSaveConsent } from "../../lib/checkout/messages";
import type { WalletType } from "../../lib/checkout/wallet-sheet";

export function WalletSaveConsent(props: {
	setupFutureUsage: "off_session" | undefined;
	applePay: boolean;
	googlePay: boolean;
	payPal: boolean;
}) {
	if (props.setupFutureUsage !== "off_session") return null;
	const wallets = [
		props.applePay ? "Apple Pay" : null,
		props.googlePay ? "Google Pay" : null,
		props.payPal ? "PayPal" : null,
	].filter((name): name is string => name !== null);
	if (wallets.length === 0) return null;
	return <p className="ck-wallet-consent">{walletSaveConsent(wallets)}</p>;
}

export function WalletButtons(props: {
	applePay: boolean;
	googlePay: boolean;
	payPal: boolean;
	payPalButton: WalletButtonArt | null;
	disabled: boolean;
	onPay: (type: WalletType) => void;
}) {
	const { payPalButton } = props;
	return (
		<>
			{props.applePay ? (
				// Empty on purpose: Safari paints Apple's button via
				// -webkit-appearance; other browsers use the black mark on this
				// class. The label is for screen readers.
				<button
					type="button"
					className="ck-apple-pay"
					aria-label="Apple Pay"
					disabled={props.disabled}
					onClick={() => props.onPay("apple_pay")}
				/>
			) : null}
			{props.googlePay ? (
				// Empty on purpose: the G Pay mark is the class's background image.
				// The label is for screen readers.
				<button
					type="button"
					className="ck-google-pay"
					aria-label="Google Pay"
					disabled={props.disabled}
					onClick={() => props.onPay("google_pay")}
				/>
			) : null}
			{props.payPal ? (
				// PayPal's own art, served with its availability, is the
				// background. The label is for screen readers.
				<button
					type="button"
					className="ck-paypal"
					aria-label="PayPal"
					disabled={props.disabled}
					style={
						payPalButton
							? {
									backgroundColor: payPalButton.light.color,
									backgroundImage: `url(${JSON.stringify(payPalButton.light.image)})`,
								}
							: undefined
					}
					onClick={() => props.onPay("paypal_express")}
				>
					{payPalButton ? null : "PayPal"}
				</button>
			) : null}
		</>
	);
}
