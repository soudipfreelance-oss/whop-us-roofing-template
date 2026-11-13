// A page built under settings the server no longer has (`store_updated`) gets
// the current ones only from a full load: the router can't swap its own code.
export function ReloadButton() {
	return (
		<button
			className="ck-link-button"
			type="button"
			onClick={() => window.location.reload()}
		>
			Reload
		</button>
	);
}
