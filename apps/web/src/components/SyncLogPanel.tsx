"use client";

// Current sync status line. The detailed log is in the Console card (bottom right).
export function SyncLogPanel({ status }: { status: React.ReactNode }) {
  if (!status) return null;
  return (
    <section className="sync-panel">
      <div className="sync-panel-head">
        <div className="sync-panel-status">{status}</div>
      </div>
    </section>
  );
}
