import type { Metadata } from "next";
import EmailSignup from "./EmailSignup";
import styles from "./landing.module.css";

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
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroContent}>
            <span className={`${styles.eyebrow} ${styles.reveal} ${styles.delay1}`}>
              Project Control Center
            </span>
            <h1 className={`${styles.heroTitle} ${styles.reveal} ${styles.delay2}`}>
              Local-first command center for AI-built projects.
            </h1>
            <p className={`${styles.heroCopy} ${styles.reveal} ${styles.delay3}`}>
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
            <div className={`${styles.valueRow} ${styles.reveal} ${styles.delay5}`}>
              <div className={styles.valueItem}>
                <div className={styles.valueLabel}>Spec-first execution</div>
                <div className={styles.valueCopy}>
                  Goals, acceptance criteria, and stop conditions drive every run.
                </div>
              </div>
              <div className={styles.valueItem}>
                <div className={styles.valueLabel}>Live telemetry</div>
                <div className={styles.valueCopy}>
                  Track active work orders and agent focus in real time.
                </div>
              </div>
              <div className={styles.valueItem}>
                <div className={styles.valueLabel}>Local control</div>
                <div className={styles.valueCopy}>
                  SQLite state and local runners keep everything on your machine.
                </div>
              </div>
            </div>
          </div>
          <div className={`${styles.heroPanel} ${styles.reveal} ${styles.delay4}`}>
            <div className={`card ${styles.heroCard}`}>
              <div className={styles.heroCardTitle}>Control loop</div>
              <ul className={styles.heroList}>
                <li>Define a Work Order before any run starts.</li>
                <li>Builder and reviewer run in a gated loop.</li>
                <li>Ship only when the output clears review.</li>
              </ul>
              <div className={styles.heroBadges}>
                <span className="badge">Local-first</span>
                <span className="badge">Live view</span>
                <span className="badge">VM-ready</span>
              </div>
            </div>
            <div className={`card ${styles.heroCardSecondary}`}>
              <div className={styles.heroCardTitle}>Why teams use PCC</div>
              <div className={styles.heroStatGrid}>
                <div>
                  <div className={styles.heroStatLabel}>Work order clarity</div>
                  <div className={styles.heroStatValue}>Goals and criteria up front.</div>
                </div>
                <div>
                  <div className={styles.heroStatLabel}>Run visibility</div>
                  <div className={styles.heroStatValue}>See shifts and logs live.</div>
                </div>
                <div>
                  <div className={styles.heroStatLabel}>Safe shipping</div>
                  <div className={styles.heroStatValue}>Review gates before merge.</div>
                </div>
              </div>
            </div>
          </div>
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
    </main>
  );
}
