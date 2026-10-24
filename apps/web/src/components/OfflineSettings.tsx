import { HardDrive, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { disableOffline, enableOffline, offlineSupported, removeCachedPaper, storageUse, useCachedPapers, useOfflineOn } from "../lib/offline";
import { useDocs } from "../lib/documents";
import { showNotice } from "../lib/notice";

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1)} MB`;

/** Settings: keep the papers that are opened on this device so they can be read without a connection. Off until it is switched on here. */
export function OfflineSettings({ idPrefix }: { idPrefix: string }) {
  const on = useOfflineOn();
  const [busy, setBusy] = useState(false);
  // shown as chosen at once while the worker is being set up (a switch that waits a second before it moves feels broken)
  const [want, setWant] = useState<boolean | null>(null);
  const kept = useCachedPapers();
  const docs = useDocs().items;
  const [use, setUse] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => {
    if (on) void storageUse().then(setUse);
  }, [on, kept]);

  if (!offlineSupported()) {
    return (
      <section className="settings-sec" aria-labelledby={`${idPrefix}-off`}>
        <h3 id={`${idPrefix}-off`} className="settings-h">Offline reading</h3>
        <p className="settings-p">This browser cannot keep papers for offline reading.</p>
      </section>
    );
  }

  const toggle = async (next: boolean) => {
    setBusy(true);
    setWant(next);
    try {
      if (next) {
        const r = await enableOffline();
        if (r !== "ok") showNotice(r === "unsupported" ? "This browser cannot keep papers for offline reading." : "Offline reading could not be switched on. Please try again.");
      } else await disableOffline();
    } finally {
      setBusy(false);
      setWant(null);
    }
  };
  const title = (id: string) => docs.find((d) => d.id === id)?.title ?? "A paper";
  const ids = [...kept];

  return (
    <section className="settings-sec" aria-labelledby={`${idPrefix}-off`}>
      <h3 id={`${idPrefix}-off`} className="settings-h">Offline reading</h3>
      <label className="settings-check">
        <input type="checkbox" checked={want ?? on} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
        <span>Keep the papers I open on this device, so I can read them without a connection</span>
      </label>
      <p className="settings-p">
        The app and the ten papers you opened last (with your notes and drawings) are kept in this browser. Drawings you make without a connection are kept too and sent when you are back online.
        <strong> Do not switch this on on a shared computer.</strong> Signing out, or switching this off, removes everything that was kept.
      </p>
      {on && (
        <div className="offline-list">
          <p className="meta-fine" role="status">
            <HardDrive size={13} aria-hidden="true" /> {ids.length === 0 ? "No paper is kept yet: open one while you have a connection." : `${ids.length} ${ids.length === 1 ? "paper is" : "papers are"} kept on this device.`}
            {use ? ` This site uses ${mb(use.used)} of the ${mb(use.quota)} the browser allows.` : ""}
          </p>
          {ids.length > 0 && (
            <ul className="offline-papers" aria-label="Papers kept on this device">
              {ids.map((id) => (
                <li key={id}>
                  <span>{title(id)}</span>
                  <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${title(id)} from this device`} title="Remove from this device" onClick={() => void removeCachedPaper(id)}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

