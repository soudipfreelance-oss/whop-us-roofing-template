import { useEffect, useRef, useState } from "react";
import { createAttemptHolder, restoredFromCache } from "./charge-attempt";
import {
	clearCharging,
	findOrderMark,
	forgetOrderMark,
	markCharging,
	markFor,
	markOrderPayment,
	type OrderMark,
	orderMarksChanged,
	readOrderMarks,
	recheckMark,
} from "./order-marks";
import { SERVER_WAIT_MS, within } from "./deadline";
import { storeLocks, storeStorage, tabStorage } from "./environment";
import { readPaymentState } from "./order.functions";
import type { ChargeControls } from "./use-charge-attempt";

// Held by the page, not one cart's checkout: a new cart, address or promo code
// would otherwise be free to charge the buyer a second time. The checkout and a
// product page's wallet buttons read the same stored attempt.
export function useChargeControls(): ChargeControls & { ready: boolean } {
	const [holder] = useState(() => createAttemptHolder(tabStorage));
	// Read again when they may have changed under the page: another tab's
	// storage event, a return from the browser's cache, buying again.
	const [marks, setMarks] = useState<readonly OrderMark[]>([]);
	const [attemptStored, setAttemptStored] = useState(false);
	const [ready, setReady] = useState(false);
	// A keyed remount or a page restored from the browser's cache starts a new
	// checkout while the old one's charge may still be running.
	const chargingRef = useRef(false);
	// Back from another page out of the browser's cache, `restoredFromCache`
	// clears this; the stored attempt guards the charge from then on.
	const leavingRef = useRef(false);
	const generationRef = useRef(0);
	const [restored, setRestored] = useState(0);
	const [declinedHere, setDeclinedHere] = useState<ReadonlyMap<string, string>>(
		new Map(),
	);
	const recheckedRef = useRef(new Set<string>());

	useEffect(() => {
		setAttemptStored(holder.load() !== null);
		setMarks(readOrderMarks(storeStorage));
		setReady(true);
		function onStorage(event: StorageEvent) {
			if (orderMarksChanged(event.key)) {
				setMarks(readOrderMarks(storeStorage));
			}
		}
		function onPageShow(event: PageTransitionEvent) {
			if (!event.persisted) return;
			const restored = restoredFromCache({
				holder,
				inFlight: chargingRef,
				leaving: leavingRef,
				generation: generationRef,
			});
			setAttemptStored(restored.stored);
			setMarks(readOrderMarks(storeStorage));
			setRestored((count) => count + 1);
		}
		window.addEventListener("pageshow", onPageShow);
		window.addEventListener("storage", onStorage);
		return () => {
			window.removeEventListener("pageshow", onPageShow);
			window.removeEventListener("storage", onStorage);
		};
	}, [holder]);

	return {
		ready,
		stored: attemptStored,
		current: holder.current,
		record: (attempt) => {
			const stored = holder.record(attempt);
			setAttemptStored(true);
			return stored;
		},
		forget: (key) => {
			if (holder.forget(key)) setAttemptStored(false);
		},
		marked: (order) =>
			markFor(findOrderMark(marks, order), declinedHere.get(order) ?? null),
		// Storage again, not the render's marks: another tab can mark the order
		// paid while this one sits in a token step or a wallet sheet.
		markedNow: (order) =>
			markFor(
				findOrderMark(readOrderMarks(storeStorage), order),
				declinedHere.get(order) ?? null,
			),
		buyAgain: async (order, paymentId) => {
			await forgetOrderMark(order, storeStorage, storeLocks(), paymentId);
			setMarks(readOrderMarks(storeStorage));
		},
		// The claim took the place of the decline this tab saw
		// (`markCharging`), so the tab lets go of it.
		payingAgain: (order) => {
			if (!declinedHere.has(order)) return;
			setDeclinedHere((seen) => withoutOrder(seen, order));
			setMarks(readOrderMarks(storeStorage));
		},
		recheckMark: (mark) => {
			void recheckMark(
				mark,
				recheckedRef.current,
				(paymentId) =>
					within(readPaymentState({ data: { paymentId } }), SERVER_WAIT_MS),
				storeStorage,
				storeLocks(),
			).then((changed) => {
				if (changed) setMarks(readOrderMarks(storeStorage));
			});
		},
		markCharging: async (order, key, returnToken) => {
			const claim = await markCharging(
				order,
				key,
				storeStorage,
				storeLocks(),
				Date.now,
				declinedHere.get(order) ?? null,
				returnToken,
			);
			setMarks(readOrderMarks(storeStorage));
			return claim;
		},
		clearCharging: async (order, key) => {
			await clearCharging(order, key, storeStorage, storeLocks());
			setMarks(readOrderMarks(storeStorage));
		},
		markPayment: async (order, paymentId, state) => {
			const marked = await markOrderPayment(
				order,
				paymentId,
				state,
				storeStorage,
				storeLocks(),
			);
			if (state === "declined") {
				setDeclinedHere((seen) => new Map(seen).set(order, paymentId));
			}
			setMarks(readOrderMarks(storeStorage));
			return marked;
		},
		inFlight: chargingRef,
		leaving: leavingRef,
		generation: generationRef,
		restored,
	};
}

function withoutOrder(
	seen: ReadonlyMap<string, string>,
	order: string,
): ReadonlyMap<string, string> {
	const next = new Map(seen);
	next.delete(order);
	return next;
}
