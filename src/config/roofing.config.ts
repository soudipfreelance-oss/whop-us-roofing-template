export interface ServicePlan {
  id: "inspection" | "deposit" | "flatrate";
  planId: string;
  category: "Inspection" | "Replacement" | "Repair";
  name: string;
  price: number;
  badge: string;
  description: string;
  features: string[];
  isDeposit?: boolean;
}
export const WHOP_ACCOUNT_ID = "biz_XJwmVQiE0CA0Kg";
export const COMPANY_PRESETS = {
  apex: { companyName: "Apex Shield Roofing Co.", cityState: "Austin, TX", phone: "(512) 555-0194", license: "TX-ROOF-88492 · GAF Master Elite", tagline: "Storm-Rated Roof Replacements & 24/7 Leak Repair", serviceAreas: ["Austin, TX", "Round Rock, TX", "Cedar Park, TX", "Georgetown, TX", "Pflugerville, TX", "Lakeway, TX"] },
  summit: { companyName: "Summit Ridge Exteriors", cityState: "Denver, CO", phone: "(303) 555-0148", license: "CO-LIC-44910 · Owens Corning Platinum", tagline: "Impact-Resistant Hail Roofs & Rapid Ridge Repair", serviceAreas: ["Denver, CO", "Aurora, CO", "Lakewood, CO", "Arvada, CO", "Littleton, CO", "Boulder, CO"] },
};
export const ROOFING_PLANS: ServicePlan[] = [
  { id: "inspection", planId: "plan_h2DKcSigc9dnf", category: "Inspection", name: "21-Point Drone & Attic Roof Inspection", price: 149, badge: "Same-Day Report", description: "High-res thermal moisture scan and insurance-ready photo documentation.", features: ["4K aerial drone roof imagery", "Attic decking & ventilation audit", "100% credited toward any repair"] },
  { id: "deposit", planId: "plan_Yf4GLDnLPz6IV", category: "Replacement", name: "Full Roof Replacement Kickoff Deposit", price: 500, badge: "Card-on-File Vault", description: "Locks your installation date and saves your card on file for final balance billing.", features: ["Class-4 impact architectural shingles", "Card vaulted via Whop Setup Intent", "Monthly BNPL financing at checkout"], isDeposit: true },
  { id: "flatrate", planId: "plan_P4R2wWUZlFbJW", category: "Repair", name: "Flat-Rate Emergency Leak & Pipe Boot Repair", price: 399, badge: "Fixed Price", description: "Rapid-response leak sealing, pipe boot replacement, and color-matched shingles.", features: ["Zero surprise hourly charges", "Ice & water shield underlayment", "2-year leak-free guarantee"] },
];
export const HOMEOWNER_REVIEWS = [
  { author: "Marcus & Elena R.", text: "Booked the $149 drone inspection on Tuesday, locked our $500 deposit online, and had a brand-new roof installed by Friday." },
  { author: "David K.", text: "Upfront pricing with zero pushy salespeople. Seeing flexible monthly payment options right inside Whop checkout made replacing our roof easy." },
  { author: "Sarah M.", text: "Used their $399 flat-rate leak service after a heavy storm. Technician arrived in 3 hours and sealed our flashing cleanly." },
];