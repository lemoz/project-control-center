"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function StarToggle({
  repoId,
  initialStarred,
}: {
  repoId: string;
  initialStarred: boolean;
}) {
  const [starred, setStarred] = useState(initialStarred);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const next = !starred;
    setStarred(next);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/repos/${encodeURIComponent(repoId)}/star`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starred: next }),
        });
        if (!res.ok) throw new Error("failed");
        router.refresh();
      } catch {
        setStarred(!next);
      }
    });
  };

  return (
    <button
      onClick={onToggle}
      disabled={isPending}
      aria-label={starred ? "Unstar project" : "Star project"}
      title={starred ? "Unstar project" : "Star project"}
      style={{
        background: "transparent",
        border: "none",
        color: starred ? "#f5c542" : "#7c8ab0",
        fontSize: 20,
        cursor: "pointer",
        padding: 0,
        lineHeight: 1,
      }}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
