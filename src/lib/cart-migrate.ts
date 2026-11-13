import { lineQuantity } from "./checkout/order";
import { isRecord } from "./checkout/shared";

// A line carries no price: checkout prices the cart again.
export type CartLine = {
	planId: string;
	title: string;
	quantity: number;
	image?: string;
};

export const CART_VERSION = 2;

// Version 1 lines also kept a price in cents, which nothing read. A saved
// quantity the cart could have written (a whole number) is held to the line
// rule (`lineQuantity`); any other drops the line.
export function migrateSavedCart(saved: unknown): { lines: CartLine[] } {
	const lines =
		isRecord(saved) && Array.isArray(saved.lines) ? saved.lines : [];
	return {
		lines: lines.flatMap((line): CartLine[] => {
			if (
				!isRecord(line) ||
				typeof line.planId !== "string" ||
				typeof line.title !== "string" ||
				typeof line.quantity !== "number" ||
				!Number.isInteger(line.quantity)
			) {
				return [];
			}
			const quantity = lineQuantity(line.quantity);
			if (quantity < 1) return [];
			return [
				{
					planId: line.planId,
					title: line.title,
					quantity,
					...(typeof line.image === "string" ? { image: line.image } : {}),
				},
			];
		}),
	};
}
