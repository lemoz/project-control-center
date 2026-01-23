---
id: WO-2026-147
title: Agent-Canvas Focus Sync Implementation
goal: Connect agent decisions to canvas focus so the orbital visualization follows where the agent is working.
context:
  - WO-2026-140 research doc (docs/agent-canvas-focus-sync-wo-2026-140.md)
  - WO-2026-145 (Single-Project Orbital Canvas) - renders WO nodes
  - Landing page shows live PCC agent working
  - Poll-based sync (no new realtime infra)
  - Tier 2 priority (visibility layer)
acceptance_criteria:
  - Focus resolution logic (waiting_for_input > review > testing > building)
  - Poll shift-context every 5-10s with backoff when hidden
  - Follow mode (canvas auto-centers on focus changes)
  - Manual mode (user controls camera, focus just highlighted)
  - Transition triggers (user interaction -> manual, resume/idle -> follow)
  - Mode chip UI showing current mode and focus
  - Always highlight agent-focused node with ring/glow
  - Resume following button when in manual mode
  - 30s idle timeout to auto-resume follow
  - Debounce burst focus changes (300-500ms)
non_goals:
  - SSE/WebSocket push (future enhancement)
  - Multiple agent support
  - Project-level focus (WO-only for landing page)
stop_conditions:
  - Keep polling simple, avoid over-engineering
  - If latency is too slow, document and revisit
priority: 2
tags:
  - implementation
  - ui
  - canvas
  - visualization
  - landing-page
estimate_hours: 6
status: you_review
created_at: 2026-01-22
updated_at: 2026-01-23
depends_on:
  - WO-2026-140
  - WO-2026-145
era: v2
---
## Implementation Plan

### 1. Focus Resolution

```ts
// app/landing/hooks/useAgentFocus.ts
type AgentFocus = {
  kind: 'work_order' | 'project' | 'none';
  work_order_id?: string;
  run_id?: string;
  status?: string;
  source: 'active_run' | 'handoff' | 'idle';
  updated_at: string;
};

function resolveAgentFocus(shiftContext: ShiftContext): AgentFocus {
  const activeRuns = shiftContext.active_runs || [];
  
  // Priority: waiting_for_input > review > testing > building
  const priorityOrder = ['waiting_for_input', 'you_review', 'ai_review', 'testing', 'building'];
  
  for (const status of priorityOrder) {
    const run = activeRuns.find(r => r.status === status);
    if (run) {
      return {
        kind: 'work_order',
        work_order_id: run.work_order_id,
        run_id: run.id,
        status: run.status,
        source: 'active_run',
        updated_at: run.started_at,
      };
    }
  }
  
  // Fallback to handoff priorities or idle
  // ...
}
```

### 2. Polling Hook

```ts
// app/landing/hooks/useAgentFocusSync.ts
function useAgentFocusSync(projectId: string, intervalMs = 5000) {
  const [focus, setFocus] = useState<AgentFocus | null>(null);
  const isVisible = usePageVisibility();
  
  useEffect(() => {
    if (!isVisible) return; // back off when hidden
    
    const poll = async () => {
      const ctx = await fetchShiftContext(projectId);
      const newFocus = resolveAgentFocus(ctx);
      setFocus(prev => focusChanged(prev, newFocus) ? newFocus : prev);
    };
    
    poll();
    const id = setInterval(poll, intervalMs);
    return () => clearInterval(id);
  }, [projectId, intervalMs, isVisible]);
  
  return focus;
}
```

### 3. Mode State Machine

```ts
type CanvasMode = 'follow' | 'manual';

function useCanvasMode(focus: AgentFocus | null) {
  const [mode, setMode] = useState<CanvasMode>('follow');
  const [pendingFocus, setPendingFocus] = useState<AgentFocus | null>(null);
  const lastInteraction = useRef<number>(Date.now());
  
  // User interaction -> manual
  const onUserInteraction = () => {
    setMode('manual');
    lastInteraction.current = Date.now();
  };
  
  // Resume following
  const resumeFollow = () => {
    setMode('follow');
    setPendingFocus(null);
  };
  
  // Idle timeout (30s) -> auto-resume
  useIdleTimeout(30000, () => {
    if (mode === 'manual') resumeFollow();
  });
  
  // Focus change handling
  useEffect(() => {
    if (mode === 'follow') {
      // Auto-animate to new focus (handled by canvas)
    } else {
      setPendingFocus(focus); // Show badge only
    }
  }, [focus, mode]);
  
  return { mode, pendingFocus, onUserInteraction, resumeFollow };
}
```

### 4. UI Components

```tsx
// Mode chip (corner of canvas)
<FocusModeChip 
  mode={mode} 
  focus={focus}
  pendingFocus={pendingFocus}
  onResume={resumeFollow}
/>

// Shows:
// - Follow: "Following agent • WO-138"
// - Manual: "Manual • Agent on WO-142 • [Resume]"
// - Idle: "Agent idle"
```

### 5. Canvas Integration

- Pass `focusedNodeId` to OrbitalGravityViz
- Animate camera to focused node when in follow mode
- Apply highlight ring/glow to focused node always
- Wire user interaction events (click, drag, pan, zoom) to `onUserInteraction`
