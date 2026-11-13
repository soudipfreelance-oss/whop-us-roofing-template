import { currencyToggle } from "../../lib/checkout/currency-pick";
import {
	promoAwaitingNote,
	taxNote,
	taxRow,
} from "../../lib/checkout/messages";
import {
	amountDue,
	inQuoteCurrency,
	money,
	type Order,
	type PromoAwaiting,
	type Quote,
	quotedLinePrice,
	shownMoney,
	struckPrice,
	struckSavings,
} from "../../lib/checkout/order";

function TagIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M1.5 7.2V2.5a1 1 0 0 1 1-1h4.7a1 1 0 0 1 .7.3l6.3 6.3a1 1 0 0 1 0 1.4l-4.7 4.7a1 1 0 0 1-1.4 0L1.8 7.9a1 1 0 0 1-.3-.7Z"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.2"
			/>
			<circle cx="4.8" cy="4.8" r="1" fill="currentColor" />
		</svg>
	);
}

// Some products have no gallery image at all, and an empty string in an
// <img src> renders as a broken image — show a plain gray block of the same
// shape instead.
function Thumb(props: { image: string; title: string; quantity: number }) {
	return (
		<div className="ck-thumb-wrap">
			{props.image ? (
				<img className="ck-thumb" src={props.image} alt={props.title} />
			) : (
				<div className="ck-thumb ck-thumb-empty" aria-hidden="true" />
			)}
			<span className="ck-badge">{props.quantity}</span>
		</div>
	);
}

export type PromoControls = {
	visible: boolean;
	applied: string | null;
	awaiting: PromoAwaiting | null;
	draft: string;
	pending: boolean;
	error: string | null;
	onDraftChange: (value: string) => void;
	onApply: () => void;
	onRemove: () => void;
};

export type CurrencyControls = {
	options: string[];
	pending: boolean;
	error: string | null;
	onPick: (code: string) => void;
};

function PromoCode(props: { promo: PromoControls }) {
	const { promo } = props;
	if (!promo.visible) return null;
	return (
		<div className="ck-promo">
			{promo.awaiting ? (
				<p className="ck-promo-note">
					{promoAwaitingNote(promo.awaiting)}{" "}
					<button
						className="ck-link-button"
						type="button"
						disabled={promo.pending}
						onClick={promo.onRemove}
					>
						Remove
					</button>
				</p>
			) : promo.applied ? (
				<div className="ck-promo-applied">
					<span className="ck-promo-chip">
						<TagIcon />
						{promo.applied}
					</span>
					<button
						className="ck-link-button"
						type="button"
						disabled={promo.pending}
						onClick={promo.onRemove}
					>
						Remove
					</button>
				</div>
			) : (
				<form
					className="ck-promo-form"
					onSubmit={(event) => {
						event.preventDefault();
						promo.onApply();
					}}
				>
					<input
						className="ck-input"
						placeholder="Discount code"
						aria-label="Discount code"
						value={promo.draft}
						onChange={(event) => promo.onDraftChange(event.target.value)}
					/>
					<button
						className="ck-promo-apply"
						type="submit"
						disabled={promo.pending || !promo.draft.trim()}
					>
						Apply
					</button>
				</form>
			)}
			{promo.error ? <p className="ck-promo-error">{promo.error}</p> : null}
		</div>
	);
}

export function OrderSummary(props: {
	order: Order;
	quote: Quote | null;
	promo: PromoControls;
	currencies?: CurrencyControls | null;
}) {
	const { order, quote } = props;
	const shown = shownMoney(order, quote);
	const lines = order.lines.map((line) => {
		const struck = struckPrice(line);
		return {
			...line,
			price: quotedLinePrice(order, quote, line),
			originalPrice:
				struck === undefined
					? undefined
					: (inQuoteCurrency(struck, order, quote) ?? undefined),
		};
	});
	const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
	const subtotal =
		quote?.subtotal ?? lines.reduce((sum, line) => sum + (line.price ?? 0), 0);
	const discount = quote?.discount ?? 0;
	const total = amountDue(order, quote).amount;
	const discountLabel = quote?.promoCode
		? `Discount (${quote.promoCode})`
		: "Discount";
	const tax = taxRow(quote);
	const note = taxNote(quote);
	const savings = struckSavings(order, quote) - discount;
	const toggle = props.currencies
		? currencyToggle(quote, props.currencies.options, props.currencies)
		: null;
	const switching = props.currencies?.pending ?? false;

	return (
		<div className="ck-summary ck-fade-in">
			{lines.map((line, index) => (
				<div className="ck-line" key={`${line.title}-${index}`}>
					<Thumb
						image={line.image}
						title={line.title}
						quantity={line.quantity}
					/>
					<div className="ck-line-body">
						<p className="ck-line-title">{line.title}</p>
						<p className="ck-line-subtitle">{line.subtitle}</p>
					</div>
					<div className="ck-line-prices">
						{line.originalPrice !== undefined ? (
							<p className="ck-line-original">
								{money(line.originalPrice, shown)}
							</p>
						) : null}
						{line.price === null ? null : (
							<p className="ck-line-price">{money(line.price, shown)}</p>
						)}
					</div>
				</div>
			))}

			<PromoCode promo={props.promo} />

			<div className="ck-totals">
				<div className="ck-total-row">
					<span>
						Subtotal · {itemCount} item{itemCount === 1 ? "" : "s"}
					</span>
					<span>{money(subtotal, shown)}</span>
				</div>
				{discount < 0 ? (
					<div className="ck-total-row">
						<span>{discountLabel}</span>
						<span>{money(discount, shown)}</span>
					</div>
				) : null}
				<div className="ck-total-row">
					<span>Shipping</span>
					<span>Included</span>
				</div>
				{tax ? (
					<div className="ck-total-row">
						<span>{tax.label}</span>
						<span>{tax.figure}</span>
					</div>
				) : null}
				<div className="ck-grand">
					<span>Total</span>
					<span
						className="ck-grand-amount"
						aria-live="polite"
						aria-busy={switching || undefined}
					>
						{money(total, shown)}
					</span>
				</div>
				{toggle ? (
					<button
						className="ck-currency-toggle"
						type="button"
						disabled={toggle.disabled}
						onClick={toggle.pick}
					>
						{toggle.label}
					</button>
				) : null}
				{props.currencies?.error ? (
					<p className="ck-promo-error">{props.currencies.error}</p>
				) : null}
				{savings > 0 ? (
					<div className="ck-savings">
						<span className="ck-savings-label">
							<TagIcon />
							TOTAL SAVINGS
						</span>
						<span>{money(savings, shown)}</span>
					</div>
				) : null}
				{note ? <p className="ck-tax">{note}</p> : null}
			</div>
		</div>
	);
}
