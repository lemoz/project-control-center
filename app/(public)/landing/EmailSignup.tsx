"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import styles from "./landing.module.css";

type SignupStatus = "idle" | "loading" | "success" | "error";

const DEFAULT_NOTE = "No spam. Unsubscribe anytime.";

export default function EmailSignup() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<SignupStatus>("idle");
  const [note, setNote] = useState(DEFAULT_NOTE);

  const isLoading = status === "loading";
  const isSuccess = status === "success";
  const isError = status === "error";

  const noteText = isSuccess || isError ? note : DEFAULT_NOTE;
  const buttonLabel = isLoading
    ? "Joining..."
    : isSuccess
      ? "You're on the list"
      : "Join the list";

  const resetToIdle = () => {
    if (status === "error") {
      setStatus("idle");
      setNote(DEFAULT_NOTE);
    }
  };

  const handleEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
    resetToIdle();
  };

  const handleCompanyChange = (event: ChangeEvent<HTMLInputElement>) => {
    setCompany(event.target.value);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || isSuccess) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setStatus("error");
      setNote("Enter an email that includes @.");
      return;
    }

    if (company.trim()) {
      setStatus("success");
      setNote("You're on the list.");
      return;
    }

    setStatus("loading");
    setNote(DEFAULT_NOTE);

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          source: "landing_page",
          company,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const errorMessage =
          payload?.error ?? "Unable to subscribe right now. Try again.";
        setStatus("error");
        setNote(errorMessage);
        return;
      }

      if (payload?.status === "already_exists") {
        setStatus("success");
        setNote("You're already on the list.");
        return;
      }

      setStatus("success");
      setNote("You're on the list.");
    } catch {
      setStatus("error");
      setNote("Unable to subscribe right now. Try again.");
    }
  };

  return (
    <>
      <form className={styles.signupForm} onSubmit={handleSubmit} noValidate>
        <div className={styles.honeypot} aria-hidden="true">
          <label htmlFor="landing-company">Company</label>
          <input
            id="landing-company"
            name="company"
            type="text"
            autoComplete="off"
            tabIndex={-1}
            value={company}
            onChange={handleCompanyChange}
          />
        </div>
        <input
          className={`input ${isError ? styles.signupInputError : ""}`}
          type="email"
          placeholder="you@domain.com"
          aria-label="Email address"
          aria-invalid={isError}
          autoComplete="email"
          disabled={isLoading || isSuccess}
          value={email}
          onChange={handleEmailChange}
        />
        <button className="btn" type="submit" disabled={isLoading || isSuccess}>
          {buttonLabel}
        </button>
      </form>
      <div
        className={`${styles.signupNote} ${
          isSuccess ? styles.signupNoteSuccess : isError ? styles.signupNoteError : ""
        }`}
        role={isError ? "alert" : "status"}
        aria-live="polite"
      >
        {noteText}
      </div>
    </>
  );
}
