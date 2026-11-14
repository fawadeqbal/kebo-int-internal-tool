"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pause, Play } from "lucide-react";
import type { DevLogLine } from "@kebo/shared";
import { Button, Card, CardHeader, cn, Select } from "@kebo/ui";
import { readLogAction } from "./actions";

const KEEP = 1000;
const EVERY_MS = 2000;
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

/**
 * A service's live log: the end of it, then new lines every 2 seconds. Pause, errors only and a
 * search filter what is shown; the view follows new lines while it is at the bottom.
 */
export function LiveLog({ service, services }: { service: string; services: { key: string; label: string }[] }) {
  const router = useRouter();
  const [lines, setLines] = useState<DevLogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [q, setQ] = useState("");
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const pausedRef = useRef(false);
  const next = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A new service mounts a new viewer (keyed by service), so it starts empty.
    next.current = null;
    const tick = async () => {
      if (stop) return;
      if (!pausedRef.current && document.visibilityState === "visible") {
        try {
          const r = await readLogAction(service, next.current);
          if (stop) return;
          setFailed(false);
          setMissing(r.missing);
          next.current = r.next;
          if (r.lines.length) setLines((prev) => [...prev, ...r.lines].slice(-KEEP));
        } catch {
          if (!stop) setFailed(true);
        }
      }
      timer = setTimeout(tick, EVERY_MS);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [service]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    return lines.filter((l) => (!errorsOnly || l.level === "error") && (!words || l.text.toLowerCase().includes(words)));
  }, [lines, errorsOnly, q]);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  const copy = async () => {
    await navigator.clipboard.writeText(shown.map((l) => `${l.at ?? ""} ${l.text}`.trim()).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const label = services.find((s) => s.key === service)?.label ?? service;
  const errors = lines.filter((l) => l.level === "error").length;

  return (
    <Card>
      <CardHeader
        title={`Live log: ${label}`}
        description={paused ? "paused" : failed ? "could not read the log: trying again" : `new lines every 2 seconds · last ${KEEP} kept here${errors ? ` · ${errors} errors` : ""}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Select
              compact
              aria-label="Service"
              value={service}
              onChange={(e) => router.replace(`/platform/dev-tools?tab=services&service=${encodeURIComponent(e.target.value)}`, { scroll: false })}
            >
              {services.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
              {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
              {paused ? "Go on" : "Pause"}
            </Button>
            <Button size="sm" variant="secondary" onClick={copy} disabled={!shown.length}>
              <Copy aria-hidden />
              {copied ? "Copied" : "Copy"}
            </Button>
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 text-sm">
          <span className="sr-only">Find in the log</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find in the log"
            className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Errors only
        </label>
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="h-[460px] overflow-auto rounded-b-xl bg-[#15141b] px-4 py-3 font-mono text-xs leading-[19px] text-[#e6e5ee]"
        role="log"
        aria-live="off"
        aria-label={`Live log of ${label}`}
        tabIndex={0}
      >
        {missing ? (
          <p className="text-[#9391a3]">
            No live log for {label} yet. The server writes it from the next deploy (deploy/server/kebo-logs.py), or by hand: bash deploy/server/install.sh
          </p>
        ) : !shown.length ? (
          <p className="text-[#9391a3]">{lines.length ? "No line matches." : "Waiting for lines …"}</p>
        ) : (
          shown.map((l, k) => (
            <div key={k} className="break-all whitespace-pre-wrap">
              <span className="mr-2 text-[#9391a3] select-none">{clock(l.at)}</span>
              <span className={cn(l.level === "error" && "text-[#f87171]", l.level === "warn" && "text-[#fbbf24]")}>{l.text}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
