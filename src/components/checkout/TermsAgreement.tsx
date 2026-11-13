export function TermsAgreement(props: {
	seller: string;
	documents: Array<{ label: string; href: string }>;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	const { documents } = props;
	return (
		<label className="ck-terms">
			<input
				type="checkbox"
				checked={props.checked}
				onChange={(event) => props.onChange(event.target.checked)}
			/>
			<span>
				I agree to {props.seller}'s{" "}
				{documents.length === 0
					? "terms"
					: documents.map((policy, index) => (
							<span key={policy.label}>
								{index === 0
									? ""
									: index === documents.length - 1
										? " and "
										: ", "}
								<a href={policy.href} target="_blank" rel="noreferrer">
									{policy.label}
								</a>
							</span>
						))}
			</span>
		</label>
	);
}
