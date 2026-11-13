import { Link } from "@tanstack/react-router";

const footerLinks = [
	{ label: "Refund policy", to: "/policies/refund-policy" },
	{ label: "Privacy policy", to: "/policies/privacy-policy" },
	{ label: "Shipping policy", to: "/policies/shipping-policy" },
];

export function Footer() {
	return (
		<footer
			style={{
				marginTop: "auto",
				padding: "2rem",
				borderTop: "1px solid #eee",
				display: "flex",
				flexWrap: "wrap",
				gap: "1rem",
				justifyContent: "center",
			}}
		>
			{footerLinks.map((link) => (
				<Link
					key={link.to}
					to={link.to}
					style={{ textDecoration: "none", color: "inherit" }}
				>
					{link.label}
				</Link>
			))}
		</footer>
	);
}
