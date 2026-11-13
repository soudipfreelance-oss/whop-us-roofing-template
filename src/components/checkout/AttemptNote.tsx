import { useState } from "react";
import { attemptNote, START_OVER_CONFIRM } from "../../lib/checkout/messages";

// Forgetting an attempt needs the buyer's confirmation on the page: the viewer
// shows no confirm() dialogs.
export function AttemptNote(props: {
	elsewhere: { href: string | null } | null;
	pending: boolean;
	canStartOver: boolean;
	onStartOver: () => void;
	onCheck?: () => void;
	className?: string;
}) {
	const [confirming, setConfirming] = useState(false);
	const className = props.className ?? "ck-charged";
	const { elsewhere, onCheck } = props;
	const message = attemptNote({ elsewhere, payControl: !onCheck });
	return (
		<div className={className}>
			{props.pending ? (
				<p>
					{message}{" "}
					{elsewhere?.href ? <a href={elsewhere.href}>Go to it</a> : null}
					{elsewhere === null && onCheck ? (
						<button type="button" className="ck-link-button" onClick={onCheck}>
							Check on my payment
						</button>
					) : null}
				</p>
			) : null}
			{props.canStartOver && !confirming ? (
				<button
					type="button"
					className="ck-link-button"
					onClick={() => setConfirming(true)}
				>
					Start over
				</button>
			) : null}
			{props.canStartOver && confirming ? (
				<p role="alert">
					{START_OVER_CONFIRM}{" "}
					<button
						type="button"
						className="ck-link-button"
						onClick={() => {
							setConfirming(false);
							props.onStartOver();
						}}
					>
						Start over
					</button>{" "}
					<button
						type="button"
						className="ck-link-button"
						onClick={() => setConfirming(false)}
					>
						Keep waiting
					</button>
				</p>
			) : null}
		</div>
	);
}
