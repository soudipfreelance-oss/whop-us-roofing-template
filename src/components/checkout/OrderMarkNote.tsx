import { orderViewUrl } from "../../lib/checkout/charge-attempt";
import {
	type OrderMark,
	type OrderMarkState,
} from "../../lib/checkout/order-marks";
import { returnUrl } from "../../lib/checkout/environment";
import { ORDER_MARK_MESSAGES } from "../../lib/checkout/messages";

const BUY_AGAIN: Record<OrderMarkState, string> = {
	charging: "Buy again anyway",
	paid: "Buy again",
	pending: "Buy again anyway",
	declined: "Pay again",
};

export function OrderMarkNote(props: {
	mark: OrderMark;
	onBuyAgain: () => void;
	className?: string;
}) {
	return (
		<p className={props.className ?? "ck-charged"}>
			{ORDER_MARK_MESSAGES[props.mark.state]}{" "}
			{props.mark.state === "charging" ? null : (
				<>
					<a
						href={orderViewUrl(
							returnUrl(props.mark.order),
							props.mark.paymentId,
						)}
					>
						View your order
					</a>{" "}
				</>
			)}
			<button
				type="button"
				className="ck-link-button"
				onClick={props.onBuyAgain}
			>
				{BUY_AGAIN[props.mark.state]}
			</button>
		</p>
	);
}
