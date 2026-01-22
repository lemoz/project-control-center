import { Suspense } from "react";
import { CanvasShell } from "./CanvasShell";

export default function CanvasPlaygroundPage() {
  return (
    <Suspense fallback={<div className="card">Loading canvas...</div>}>
      <CanvasShell />
    </Suspense>
  );
}
