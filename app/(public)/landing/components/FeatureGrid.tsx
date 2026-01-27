import styles from "../landing.module.css";

const features = [
  {
    title: "Work Order Management",
    description:
      "Define goals, criteria, and stop conditions before any run starts.",
    icon: (
      <svg
        aria-hidden="true"
        className={styles.featureIconSvg}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="6" y="5" width="12" height="15" rx="2" />
        <path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
        <path d="M9 10h6" />
        <path d="M9 13h6" />
        <path d="M9 16h4" />
      </svg>
    ),
  },
  {
    title: "Autonomous Build Loops",
    description:
      "Builders and reviewers iterate until the output clears review.",
    icon: (
      <svg
        aria-hidden="true"
        className={styles.featureIconSvg}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 12a8 8 0 0 1 13-5" />
        <path d="M17 3v4h4" />
        <path d="M20 12a8 8 0 0 1-13 5" />
        <path d="M7 21v-4H3" />
      </svg>
    ),
  },
  {
    title: "Live Visualization",
    description:
      "Track active runs, shifts, and telemetry with real-time visibility.",
    icon: (
      <svg
        aria-hidden="true"
        className={styles.featureIconSvg}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M7 15l3-4 3 3 4-6" />
      </svg>
    ),
  },
  {
    title: "Voice Interaction",
    description: "Speak commands and hear narration without leaving the loop.",
    icon: (
      <svg
        aria-hidden="true"
        className={styles.featureIconSvg}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="4" width="6" height="10" rx="3" />
        <path d="M5 11v1a7 7 0 0 0 14 0v-1" />
        <path d="M12 18v3" />
        <path d="M9 21h6" />
      </svg>
    ),
  },
  {
    title: "Tech Tree Dependencies",
    description:
      "Map Work Order dependencies across eras, lanes, and decision gates.",
    icon: (
      <svg
        aria-hidden="true"
        className={styles.featureIconSvg}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M8 7.5l3 6" />
        <path d="M16 7.5l-3 6" />
        <path d="M8 6h8" />
      </svg>
    ),
  },
  {
    title: "Multi-Project Portfolio",
    description: "Scan, prioritize, and ship across every repo from one hub.",
    icon: (
      <svg
        aria-hidden="true"
        className={styles.featureIconSvg}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4" y="5" width="10" height="10" rx="2" />
        <rect x="10" y="9" width="10" height="10" rx="2" />
      </svg>
    ),
  },
];

const delayClasses = [
  styles.delay1,
  styles.delay2,
  styles.delay3,
  styles.delay4,
  styles.delay5,
  styles.delay6,
];

export default function FeatureGrid() {
  return (
    <div className={styles.featureGrid}>
      {features.map((feature, index) => (
        <article
          className={`${styles.featureCard} ${styles.reveal} ${delayClasses[index]}`}
          key={feature.title}
        >
          <div className={styles.featureIcon}>{feature.icon}</div>
          <div>
            <h3 className={styles.featureTitle}>{feature.title}</h3>
            <p className={styles.featureCopy}>{feature.description}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
