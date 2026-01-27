import type { Metadata } from "next";
import EmailSignup from "./EmailSignup";
import { LiveHeroEmbed } from "./LiveHeroEmbed";
import styles from "./landing.module.css";
import FeatureGrid from "./components/FeatureGrid";
import LandingFooter from "./components/LandingFooter";
import LandingHeader from "./components/LandingHeader";

export const metadata: Metadata = {
  title: "Project Control Center | Public Landing",
  description:
    "Local-first control center for AI work orders, live runs, and gated reviews.",
  openGraph: {
    title: "Project Control Center",
    description:
      "Define work orders, run builders, and ship with live visibility and review gates.",
    type: "website",
    url: "/landing",
    images: [
      {
        url: "/icon-512.png",
        width: 512,
        height: 512,
        alt: "Project Control Center",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Project Control Center",
    description:
      "Local-first control center for AI work orders, live runs, and gated reviews.",
    images: ["/icon-512.png"],
  },
};

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <LandingHeader />
      <div className={styles.pageBody}>
        <section className={styles.heroCompact}>
          <div className={styles.heroCompactInner}>
            <span className={`${styles.eyebrow} ${styles.reveal} ${styles.delay1}`}>
              Project Control Center
            </span>
            <h1 className={`${styles.heroTitleCompact} ${styles.reveal} ${styles.delay2}`}>
              Local-first command center for AI-built projects.
            </h1>
            <p className={`${styles.heroCopyCompact} ${styles.reveal} ${styles.delay3}`}>
              Define work orders, orchestrate builders, and watch every run ship with
              live visibility and gated reviews.
            </p>
            <div className={`${styles.ctaRow} ${styles.reveal} ${styles.delay4}`}>
              <a className={`btn ${styles.primaryCta}`} href="/live">
                See it Live
              </a>
              <a className={`btnSecondary ${styles.secondaryCta}`} href="#signup">
                Join the email list
              </a>
            </div>
          </div>
        </section>

        <section className={styles.canvasSection} id="live-demo">
          <LiveHeroEmbed />
        </section>

        <section className={styles.section} id="features">
          <div className={styles.sectionInner}>
            <div className={`${styles.sectionHeader} ${styles.reveal} ${styles.delay1}`}>
              <div className={styles.sectionKicker}>Feature set</div>
              <h2 className={styles.sectionTitle}>Six pillars of the PCC workflow.</h2>
              <p className={styles.sectionCopy}>
                Every capability is designed to keep builders aligned, runs visible,
                and shipping decisions intentional.
              </p>
            </div>
            <FeatureGrid />
          </div>
        </section>

        <section className={styles.section} id="how-it-works">
          <div className={styles.sectionInner}>
            <div className={`${styles.sectionHeader} ${styles.reveal} ${styles.delay1}`}>
              <div className={styles.sectionKicker}>How it works</div>
              <h2 className={styles.sectionTitle}>From Work Order to shipped run.</h2>
              <p className={styles.sectionCopy}>
                Every run starts with a clear contract, moves through a builder loop,
                and ships only after review.
              </p>
            </div>
            <div className={styles.cardGrid}>
              <div className={`card ${styles.stepCard} ${styles.reveal} ${styles.delay2}`}>
                <div className={styles.stepBadge}>01</div>
                <h3 className={styles.stepTitle}>Define WOs</h3>
                <p className={styles.stepCopy}>
                  Capture the goal, acceptance criteria, and stop conditions before the
                  builder starts.
                </p>
              </div>
              <div className={`card ${styles.stepCard} ${styles.reveal} ${styles.delay3}`}>
                <div className={styles.stepBadge}>02</div>
                <h3 className={styles.stepTitle}>AI Builds</h3>
                <p className={styles.stepCopy}>
                  The builder runs, a reviewer checks the output, and tests validate the
                  work.
                </p>
              </div>
              <div className={`card ${styles.stepCard} ${styles.reveal} ${styles.delay4}`}>
                <div className={styles.stepBadge}>03</div>
                <h3 className={styles.stepTitle}>Ship</h3>
                <p className={styles.stepCopy}>
                  Merge with confidence when review clears and the Work Order is done.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.signup} id="signup">
          <div className={styles.sectionInner}>
            <div className={`card ${styles.signupCard} ${styles.reveal} ${styles.delay2}`}>
              <div className={styles.signupText}>
                <div className={styles.sectionKicker}>Email updates</div>
                <h2 className={styles.signupTitle}>Stay close to the launch.</h2>
                <p className={styles.signupCopy}>
                  Join the early access list to get launch notes and preview invites.
                </p>
              </div>
              <EmailSignup />
            </div>
          </div>
        </section>
        <LandingFooter />
      </div>
    </main>
  );
}
