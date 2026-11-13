import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import { CHARGE_RUNNING } from "../../lib/checkout/messages";
import { BUSY_STYLES } from "./styles";

const READ_ALOUD_ONLY: CSSProperties = {
	position: "absolute",
	width: 1,
	height: 1,
	margin: -1,
	padding: 0,
	overflow: "hidden",
	clipPath: "inset(50%)",
	whiteSpace: "nowrap",
	border: 0,
};

// Nothing in the region can change under the order being charged. The
// surfaces a charge opens are never inside it: Elements mounts its 3D Secure
// dialog on `document.body`, and the wallet sheets are the browser's, or the
// wallet's own window or overlay. The status line sits outside the region, so
// a screen reader still hears the charge running.
export function BusyRegion(props: {
	busy: boolean;
	className?: string;
	style?: CSSProperties;
	children: ReactNode;
}) {
	const { busy } = props;
	const focusedRef = useRef<HTMLElement | null>(null);
	const regionRef = useRef<HTMLDivElement | null>(null);

	useLayoutEffect(() => {
		const region = regionRef.current;
		if (!busy || !region) return;
		const locked = lockAllBut(region, "[data-busy-exempt]");
		return () => {
			for (const node of locked) node.inert = false;
		};
	}, [busy]);

	useEffect(() => {
		const focused = focusedRef.current;
		if (busy || !focused?.isConnected) return;
		if (
			document.activeElement === null ||
			document.activeElement === document.body
		) {
			focused.focus();
		}
	}, [busy]);

	return (
		<>
			<style>{BUSY_STYLES}</style>
			<div
				className={props.className ? `ck-busy ${props.className}` : "ck-busy"}
				style={props.style}
				ref={regionRef}
				aria-busy={busy || undefined}
				onFocus={(event) => {
					if (event.target instanceof HTMLElement) {
						focusedRef.current = event.target;
					}
				}}
			>
				{props.children}
			</div>
			<p role="status" style={READ_ALOUD_ONLY}>
				{busy ? CHARGE_RUNNING : ""}
			</p>
		</>
	);
}

// Whop refuses a payment while its branding notice can't be hit-tested, and an
// inert notice can't be. So the region locks everything around an exempt
// subtree instead of locking itself.
function lockAllBut(root: HTMLElement, exempt: string): HTMLElement[] {
	if (!root.querySelector(exempt)) {
		root.inert = true;
		return [root];
	}
	const locked: HTMLElement[] = [];
	for (const child of root.children) {
		if (!(child instanceof HTMLElement) || child.matches(exempt)) continue;
		locked.push(...lockAllBut(child, exempt));
	}
	return locked;
}
