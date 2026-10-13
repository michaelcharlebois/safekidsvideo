"use client";

import { useEffect, useState } from "react";
import { subscribePush, unsubscribePush } from "@/app/actions";
import { Button } from "@/components/ui";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type State = "checking" | "unsupported" | "needs_install" | "off" | "on" | "denied" | "working";

/** "Notify me" control for the parent dashboard. iOS needs the app on the home screen first. */
export function NotifyButton({ vapidPublicKey, registered }: { vapidPublicKey?: string; registered: number }) {
  const [state, setState] = useState<State>("checking");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: State;
      if (!vapidPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        const ios = /iphone|ipad/i.test(navigator.userAgent);
        const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || matchMedia("(display-mode: standalone)").matches;
        next = ios && !standalone ? "needs_install" : "unsupported";
      } else if (Notification.permission === "denied") {
        next = "denied";
      } else {
        try {
          const reg = await navigator.serviceWorker.register("/sw.js");
          const sub = await reg.pushManager.getSubscription();
          next = sub ? "on" : "off";
        } catch {
          next = "unsupported";
        }
      }
      if (!cancelled) setState(next);
    })();
    return () => { cancelled = true; };
  }, [vapidPublicKey]);

  async function turnOn() {
    setState("working"); setErr(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!) });
      const json = sub.toJSON();
      await subscribePush({ endpoint: sub.endpoint, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } });
      setState("on");
    } catch (e) {
      setErr((e as Error).message); setState("off");
    }
  }

  async function turnOff() {
    setState("working");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await unsubscribePush(sub.endpoint); await sub.unsubscribe(); }
    setState("off");
  }

  if (state === "checking") return null;
  if (state === "needs_install") return <p className="text-xs text-muted">To get notifications on iPhone, add Brightframe to your home screen (Share → Add to Home Screen) and open it from there.</p>;
  if (state === "unsupported") return <p className="text-xs text-muted">Notifications aren&apos;t available in this browser.</p>;
  if (state === "denied") return <p className="text-xs text-muted">Notifications are blocked for Brightframe in your phone&apos;s settings.</p>;

  return (
    <div className="space-y-1">
      {state === "on" ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-bold text-ok">🔔 Notifications on{registered > 1 ? ` (${registered} phones)` : ""}</span>
          <Button variant="ghost" className="text-xs px-3 py-1" onClick={turnOff}>Turn off here</Button>
        </div>
      ) : (
        <Button className="w-full" onClick={turnOn} disabled={state === "working"}>
          {state === "working" ? "Setting up…" : "🔔 Notify me when my kid asks for a video"}
        </Button>
      )}
      {err && <p className="text-xs text-bad">{err}</p>}
    </div>
  );
}
