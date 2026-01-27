"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../landing.module.css";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "Live Demo", href: "#live-demo" },
  { label: "Early Access", href: "#signup" },
];

export default function LandingHeader() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const updateScrolled = () => setIsScrolled(window.scrollY > 8);
    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, []);

  const handleNavClick = () => setMenuOpen(false);

  return (
    <header
      className={`${styles.landingHeader} ${
        isScrolled ? styles.landingHeaderScrolled : ""
      }`}
    >
      <div className={styles.headerInner}>
        <Link href="/landing" className={styles.logo} aria-label="Project Control Center">
          <span className={styles.logoMark} aria-hidden="true" />
          <span className={styles.logoText}>Project Control Center</span>
        </Link>
        <nav
          id="landing-nav"
          className={`${styles.headerNav} ${menuOpen ? styles.headerNavOpen : ""}`}
          aria-label="Primary"
        >
          {navLinks.map((link) => (
            <a
              key={link.label}
              className={styles.navLink}
              href={link.href}
              onClick={handleNavClick}
            >
              {link.label}
            </a>
          ))}
          <a className={`btnSecondary ${styles.navCta}`} href="/live" onClick={handleNavClick}>
            See it Live
          </a>
        </nav>
        <div className={styles.headerActions}>
          <a className={`btn ${styles.headerCta}`} href="/live">
            See it Live
          </a>
          <button
            type="button"
            className={styles.menuButton}
            aria-label="Toggle navigation"
            aria-controls="landing-nav"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className={styles.menuIcon} aria-hidden="true">
              <span className={styles.menuLine} />
              <span className={styles.menuLine} />
              <span className={styles.menuLine} />
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
