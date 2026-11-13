import { Link } from "@tanstack/react-router";

type HeaderProps = {
	onCartOpen: () => void;
	cartCount: number;
};

export function Header({ onCartOpen, cartCount }: HeaderProps) {
	return (
		<header
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				padding: "1rem 2rem",
				borderBottom: "1px solid #eee",
			}}
		>
			<Link
				to="/"
				style={{ fontWeight: 700, textDecoration: "none", color: "inherit" }}
			>
				Store
			</Link>
			<nav style={{ display: "flex", gap: "1.25rem", alignItems: "center" }}>
				<Link
					to="/collections/$label"
					params={{ label: "all" }}
					style={{ textDecoration: "none", color: "inherit" }}
				>
					Shop
				</Link>
				<Link
					to="/pages/about-us"
					style={{ textDecoration: "none", color: "inherit" }}
				>
					About
				</Link>
				<Link
					to="/pages/contact"
					style={{ textDecoration: "none", color: "inherit" }}
				>
					Contact
				</Link>
				<button
					type="button"
					onClick={onCartOpen}
					aria-label={cartCount > 0 ? `Cart, ${cartCount} items` : "Cart"}
					style={{
						position: "relative",
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						width: "2.25rem",
						height: "2.25rem",
						padding: 0,
						border: "none",
						borderRadius: "9999px",
						background: "transparent",
						color: "inherit",
						cursor: "pointer",
					}}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.75"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M6 7h12l-1 12H7L6 7Z" />
						<path d="M9 7a3 3 0 0 1 6 0" />
					</svg>
					{cartCount > 0 ? (
						<span
							style={{
								position: "absolute",
								top: 0,
								right: 0,
								minWidth: "1.1rem",
								height: "1.1rem",
								padding: "0 0.3rem",
								borderRadius: "9999px",
								background: "#111",
								color: "#fff",
								fontSize: "0.7rem",
								fontWeight: 600,
								lineHeight: "1.1rem",
								textAlign: "center",
							}}
						>
							{cartCount}
						</span>
					) : null}
				</button>
			</nav>
		</header>
	);
}
