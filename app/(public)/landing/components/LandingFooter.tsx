import styles from "../landing.module.css";

const productLinks = [
  { label: "Features", href: "#features" },
  { label: "Live Demo", href: "#live-demo" },
  { label: "How it works", href: "#how-it-works" },
];

const resourceLinks = [
  { label: "Early Access", href: "#signup" },
  { label: "Email Updates", href: "#signup" },
  { label: "Launch Notes", href: "#signup" },
];

export default function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className={styles.landingFooter}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <div className={styles.footerLogo}>
            <span className={styles.logoMark} aria-hidden="true" />
            <span className={styles.logoText}>Project Control Center</span>
          </div>
          <p className={styles.footerCopy}>
            Local-first control for AI builders, with live telemetry and review gates.
          </p>
        </div>
        <div className={styles.footerColumns}>
          <div className={styles.footerColumn}>
            <div className={styles.footerTitle}>Product</div>
            {productLinks.map((link) => (
              <a key={link.label} className={styles.footerLink} href={link.href}>
                {link.label}
              </a>
            ))}
          </div>
          <div className={styles.footerColumn}>
            <div className={styles.footerTitle}>Resources</div>
            {resourceLinks.map((link) => (
              <a key={link.label} className={styles.footerLink} href={link.href}>
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.footerMeta}>
        <span>Copyright {year} Project Control Center</span>
        <span>Built for local-first, review-gated shipping.</span>
      </div>
    </footer>
  );
}
