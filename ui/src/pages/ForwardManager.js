//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
import React from "react";
import axios from "axios";
import {Token} from "../utils";
import {SrsErrorBoundary} from "../components/SrsErrorBoundary";

export default function ForwardManager() {
  return (
    <SrsErrorBoundary>
      <ForwardManagerImpl />
    </SrsErrorBoundary>
  );
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiPost(path, body = {}) {
  const res = await axios.post(path, body, {headers: Token.loadBearerHeader()});
  if (res.data.code !== 0) throw new Error(res.data.message || `API error code ${res.data.code}`);
  return res.data;
}

const listDestinations = () => apiPost("/terraform/v1/ffmpeg/forward/secret");
const listStreams       = () => apiPost("/terraform/v1/ffmpeg/forward/streams");
const upsertDest       = (p) => apiPost("/terraform/v1/ffmpeg/forward/secret", {action: "update", ...p});
const deleteDest       = (platform) => apiPost("/terraform/v1/ffmpeg/forward/secret", {action: "delete", platform});

function genPlatformKey() {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const chars   = "abcdefghijklmnopqrstuvwxyz0123456789";
  return letters[Math.floor(Math.random() * letters.length)]
    + Array.from({length: 11}, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ── Design tokens (light mode, all verified ≥ 4.5:1 WCAG AA) ─────────────────
const ACCENT  = "#b54100";
const BG      = "#f5f4f1";
const CARD    = "#ffffff";
const PANEL   = "#edecea";
const BORDER  = "#888582";
const HEADING = "#111111";
const BODY    = "#2b2926";
const SECOND  = "#4a4744";
const MUTED   = "#6b6865";
const DANGER  = "#b91c1c";

const mono = {fontFamily: "'Public Sans', sans-serif", fontVariantNumeric: "tabular-nums"};
const syne = {fontFamily: "'Public Sans', sans-serif"};

const inputBase = {
  ...mono, fontSize: 13, color: BODY,
  background: CARD, border: `1.5px solid ${BORDER}`,
  borderRadius: 5, outline: "none", transition: "border-color 0.15s",
  width: "100%",
};

// ── Shared components ─────────────────────────────────────────────────────────
function Btn({children, onClick, variant = "primary", disabled, small, style: extra = {}}) {
  const base = {
    ...syne, fontWeight: 700, letterSpacing: "0.04em",
    borderRadius: 5, cursor: disabled ? "not-allowed" : "pointer",
    border: "1.5px solid", transition: "all 0.15s ease",
    fontSize: small ? 11 : 13,
    padding: small ? "4px 12px" : "8px 18px",
    opacity: disabled ? 0.45 : 1, lineHeight: 1.4,
  };
  const variants = {
    primary: {background: ACCENT,       color: "#ffffff", borderColor: ACCENT},
    ghost:   {background: "transparent", color: SECOND,   borderColor: BORDER},
    danger:  {background: "#fef2f2",     color: DANGER,   borderColor: "#fca5a5"},
    dim:     {background: PANEL,         color: SECOND,   borderColor: BORDER},
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{...base, ...variants[variant], ...extra}}>
      {children}
    </button>
  );
}

function Dot({live}) {
  return (
    <span aria-hidden="true" style={{
      display: "inline-block", width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
      background: live ? ACCENT : "#b0aca8",
      boxShadow: live ? `0 0 0 3px rgba(181,65,0,0.15)` : "none",
      transition: "all 0.4s",
    }}/>
  );
}

function Toggle({value, onChange, label}) {
  return (
    <div
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: 10, cursor: "pointer",
        background: value ? ACCENT : "#c8c4be",
        border: `1.5px solid ${value ? ACCENT : "#b0aca8"}`,
        position: "relative", transition: "all 0.2s", flexShrink: 0,
      }}>
      <div style={{
        position: "absolute", top: 3, left: value ? 18 : 3,
        width: 12, height: 12, borderRadius: "50%",
        background: "#ffffff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        transition: "left 0.2s",
      }}/>
    </div>
  );
}

function Stats({log}) {
  if (!log) return null;
  const fps  = log.match(/fps=(\S+)/)?.[1];
  const br   = log.match(/bitrate=(\S+)/)?.[1];
  const time = log.match(/time=(\S+)/)?.[1];
  const items = [["FPS", fps], ["BITRATE", br], ["UPTIME", time]].filter(([, v]) => v);
  if (!items.length) return null;
  return (
    <div style={{display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10}}>
      {items.map(([k, v]) => (
        <span key={k} style={{
          ...mono, fontSize: 10, color: ACCENT,
          background: "rgba(181,65,0,0.06)", border: "1px solid rgba(181,65,0,0.2)",
          padding: "2px 8px", borderRadius: 3, letterSpacing: "0.06em",
        }}>
          <span style={{color: MUTED, marginRight: 5}}>{k}</span>{v}
        </span>
      ))}
    </div>
  );
}

// ── Search + Filter bar ───────────────────────────────────────────────────────
const FILTER_STATUS  = ["ALL", "LIVE", "IDLE"];
const FILTER_ENABLED = ["ALL", "ENABLED", "DISABLED"];

const pillStyle = (active) => ({
  ...{fontFamily: "'Public Sans', sans-serif"}, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
  padding: "4px 12px", borderRadius: 3, cursor: "pointer", border: "1.5px solid",
  transition: "all 0.15s",
  background:  active ? ACCENT       : "transparent",
  color:       active ? "#ffffff"    : SECOND,
  borderColor: active ? ACCENT       : BORDER,
});

function SearchFilterBar({query, setQuery, total, shown}) {
  return (
    <div style={{
      background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8,
      padding: "10px 16px", marginBottom: 20,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{position: "relative", flex: 1}}>
        <span aria-hidden="true" style={{
          position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
          ...mono, fontSize: 14, color: MUTED, pointerEvents: "none", lineHeight: 1,
        }}>⌕</span>
        <input
          type="search"
          aria-label="Search destinations"
          placeholder="Search by label, server URL or platform key…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{...inputBase, padding: "9px 36px 9px 34px", background: CARD}}
          onFocus={e => (e.target.style.borderColor = ACCENT)}
          onBlur={e  => (e.target.style.borderColor = BORDER)}
        />
        {query && (
          <button
            aria-label="Clear search"
            onClick={() => setQuery("")}
            style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", color: SECOND, cursor: "pointer",
              ...mono, fontSize: 14, lineHeight: 1, padding: "2px 4px",
            }}>✕</button>
        )}
      </div>
      <div style={{...mono, fontSize: 11, color: MUTED, flexShrink: 0}}>
        {shown < total
          ? <><span style={{color: ACCENT}}>{shown}</span> / {total} destinations</>
          : <><span style={{color: ACCENT}}>{total}</span> destinations</>
        }
      </div>
    </div>
  );
}

// ── Destination Card ──────────────────────────────────────────────────────────
function DestCard({dest, stream, onEdit, onDelete, onToggle}) {
  const [confirmDel, setConfirmDel] = React.useState(false);
  const isLive = !!(stream?.ready);

  return (
    <article style={{
      background: CARD,
      borderRadius: 8,
      padding: "18px 22px",
      border: `1px solid ${BORDER}`,
      borderLeft: `3px solid ${isLive ? ACCENT : "#c8c4be"}`,
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      transition: "box-shadow 0.2s",
    }}>
      <div style={{display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12}}>
        <div style={{display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0}}>
          <Dot live={isLive}/>
          <div style={{minWidth: 0, flex: 1}}>
            <div style={{...syne, fontWeight: 700, fontSize: 14, color: HEADING, marginBottom: 2}}>
              {dest.label || dest.platform}
            </div>
            <div style={{...mono, fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>
              {dest.server}
            </div>
          </div>
        </div>

        <div style={{display: "flex", alignItems: "center", gap: 10, flexShrink: 0}}>
          <span style={{
            ...mono, fontSize: 10, letterSpacing: "0.08em",
            color: isLive ? ACCENT : SECOND,
            background: isLive ? "rgba(181,65,0,0.08)" : PANEL,
            border: `1px solid ${isLive ? "rgba(181,65,0,0.25)" : BORDER}`,
            padding: "2px 8px", borderRadius: 3,
          }}>
            {isLive ? "● LIVE" : "○ IDLE"}
          </span>

          <Toggle
            value={dest.enabled}
            onChange={() => onToggle(dest)}
            label={`${dest.enabled ? "Disable" : "Enable"} ${dest.label || dest.platform}`}
          />

          <button
            onClick={() => onEdit(dest)}
            aria-label={`Edit ${dest.label || dest.platform}`}
            style={{
              background: "none", border: "1px solid transparent", color: SECOND,
              cursor: "pointer", fontSize: 15, padding: "3px 6px", lineHeight: 1,
              borderRadius: 4, transition: "all 0.15s",
            }}
            onMouseEnter={e => {e.currentTarget.style.color = HEADING; e.currentTarget.style.background = PANEL; e.currentTarget.style.borderColor = BORDER;}}
            onMouseLeave={e => {e.currentTarget.style.color = SECOND;  e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "transparent";}}
          >✎</button>

          <button
            onClick={() => setConfirmDel(true)}
            aria-label={`Delete ${dest.label || dest.platform}`}
            style={{
              background: "none", border: "1px solid transparent", color: SECOND,
              cursor: "pointer", fontSize: 15, padding: "3px 6px", lineHeight: 1,
              borderRadius: 4, transition: "all 0.15s",
            }}
            onMouseEnter={e => {e.currentTarget.style.color = DANGER; e.currentTarget.style.background = "#fef2f2"; e.currentTarget.style.borderColor = "#fca5a5";}}
            onMouseLeave={e => {e.currentTarget.style.color = SECOND; e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "transparent";}}
          >✕</button>
        </div>
      </div>

      {stream && <Stats log={stream.frame?.log}/>}

      <div style={{display: "flex", gap: 20, marginTop: 10}}>
        <span style={{...mono, fontSize: 10, color: MUTED}}>
          KEY <span style={{color: SECOND}}>{dest.secret?.slice(0, 8)}•••</span>
        </span>
        <span style={{...mono, fontSize: 10, color: MUTED}}>
          ID <span style={{color: MUTED}}>{dest.platform}</span>
        </span>
        {stream?.start && (
          <span style={{...mono, fontSize: 10, color: MUTED, marginLeft: "auto"}}>
            STARTED <span style={{color: SECOND}}>{new Date(stream.start).toLocaleTimeString()}</span>
          </span>
        )}
      </div>

      {confirmDel && (
        <div role="alertdialog" aria-label="Confirm deletion" style={{
          marginTop: 14, padding: "14px 16px", borderRadius: 6,
          background: "#fef2f2", border: "1px solid #fca5a5",
        }}>
          <div style={{...syne, fontSize: 13, color: DANGER, marginBottom: 10}}>
            Delete "{dest.label || dest.platform}"? This cannot be undone.
          </div>
          <div style={{display: "flex", gap: 8}}>
            <Btn variant="ghost" small onClick={() => setConfirmDel(false)}>Cancel</Btn>
            <Btn variant="danger" small onClick={() => {setConfirmDel(false); onDelete(dest.platform);}}>Delete</Btn>
          </div>
        </div>
      )}
    </article>
  );
}

// ── Add / Edit Modal ──────────────────────────────────────────────────────────
function DestModal({initial, onSave, onClose, saving}) {
  const [form, setForm] = React.useState(initial
    ? {label: initial.label || "", server: initial.server || "", secret: initial.secret || "", enabled: initial.enabled ?? true}
    : {label: "", server: "", secret: "", enabled: true}
  );
  const set = (k) => (e) => setForm(f => ({...f, [k]: e.target.value}));
  const valid = form.label.trim() && form.server.trim();

  React.useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const fields = [
    {label: "Destination Label",  key: "label",  ph: "e.g. YouTube Live",               type: "text"},
    {label: "RTMP Server URL",    key: "server", ph: "rtmp://a.rtmp.youtube.com/live2",  type: "url"},
    {label: "Stream Key / Secret",key: "secret", ph: "xxxx-xxxx-xxxx-xxxx",              type: "text"},
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={initial ? "Edit destination" : "New destination"}
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed", inset: 0, background: "rgba(43,41,38,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, backdropFilter: "blur(4px)",
      }}>
      <div style={{
        background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10,
        padding: "32px 36px", width: 500, maxWidth: "92vw",
        boxShadow: "0 24px 60px rgba(0,0,0,0.18)",
      }}>
        <div style={{display: "flex", alignItems: "center", gap: 12, marginBottom: 28}}>
          <div style={{width: 5, height: 28, background: ACCENT, borderRadius: 3}}/>
          <span style={{...syne, fontWeight: 800, fontSize: 18, color: HEADING}}>
            {initial ? "Edit Destination" : "New Destination"}
          </span>
        </div>

        {fields.map(({label, key, ph, type}) => (
          <div key={key} style={{marginBottom: 18}}>
            <label
              htmlFor={`field-${key}`}
              style={{
                display: "block", ...mono, fontSize: 10, color: MUTED,
                letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7,
              }}>{label}</label>
            <input
              id={`field-${key}`}
              type={type}
              style={{...inputBase, padding: "9px 12px"}}
              placeholder={ph}
              value={form[key]}
              onChange={set(key)}
              onFocus={e => (e.target.style.borderColor = ACCENT)}
              onBlur={e  => (e.target.style.borderColor = BORDER)}
            />
          </div>
        ))}

        <div style={{display: "flex", alignItems: "center", gap: 10, marginBottom: 28}}>
          <Toggle
            value={form.enabled}
            onChange={(v) => setForm(f => ({...f, enabled: v}))}
            label="Forwarding enabled"
          />
          <span style={{...syne, fontSize: 13, color: SECOND}}>
            {form.enabled ? "Forwarding enabled" : "Forwarding disabled"}
          </span>
        </div>

        <div style={{display: "flex", gap: 10, justifyContent: "flex-end"}}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={!valid || saving} onClick={() => valid && onSave(form)}>
            {saving ? "Saving…" : "Save Destination"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({filtered, onAdd, onClear}) {
  return (
    <div style={{textAlign: "center", padding: "56px 24px"}}>
      <div aria-hidden="true" style={{fontSize: 40, marginBottom: 14, color: BORDER}}>
        {filtered ? "⌕" : "⬡"}
      </div>
      <div style={{...syne, fontSize: 15, color: SECOND, marginBottom: 6}}>
        {filtered ? "No matching destinations" : "No forwarding destinations"}
      </div>
      <div style={{fontSize: 12, color: MUTED, marginBottom: 20}}>
        {filtered ? "Try adjusting your search or filters" : "Add an RTMP destination to start simulcasting"}
      </div>
      {filtered
        ? <Btn variant="ghost" onClick={onClear}>Clear Filters</Btn>
        : <Btn variant="primary" onClick={onAdd}>+ Add Destination</Btn>
      }
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────
function ForwardManagerImpl() {
  const [dests,       setDests]       = React.useState({});
  const [streams,     setStreams]     = React.useState([]);
  const [loading,     setLoading]     = React.useState(true);
  const [error,       setError]       = React.useState(null);
  const [modal,       setModal]       = React.useState(null);
  const [saving,      setSaving]      = React.useState(false);
  const [lastRefresh, setLastRefresh] = React.useState(null);
  const [query,         setQuery]         = React.useState("");
  const [statusFilter,  setStatusFilter]  = React.useState("ALL");
  const [enabledFilter, setEnabledFilter] = React.useState("ALL");
  const timerRef = React.useRef();

  const refresh = React.useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const [dRes, sRes] = await Promise.all([listDestinations(), listStreams()]);
      setDests(dRes.data || {});
      setStreams(sRes.data || []);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh(true);
    timerRef.current = setInterval(() => refresh(false), 5000);
    return () => clearInterval(timerRef.current);
  }, [refresh]);

  const streamMap = React.useMemo(() => Object.fromEntries(streams.map(s => [s.platform, s])), [streams]);
  const destList  = React.useMemo(() => Object.values(dests), [dests]);

  const filtered = React.useMemo(() => destList.filter(dest => {
    const stream = streamMap[dest.platform];
    const isLive = !!(stream?.ready);
    if (query.trim()) {
      const q = query.toLowerCase();
      if (!(dest.label?.toLowerCase().includes(q) ||
            dest.server?.toLowerCase().includes(q) ||
            dest.platform?.toLowerCase().includes(q))) return false;
    }
    if (statusFilter  === "LIVE"     && !isLive)       return false;
    if (statusFilter  === "IDLE"     &&  isLive)       return false;
    if (enabledFilter === "ENABLED"  && !dest.enabled) return false;
    if (enabledFilter === "DISABLED" &&  dest.enabled) return false;
    return true;
  }), [destList, streamMap, query, statusFilter, enabledFilter]);

  const clearFilters = () => {setQuery(""); setStatusFilter("ALL"); setEnabledFilter("ALL");};
  const isFiltered   = !!(query || statusFilter !== "ALL" || enabledFilter !== "ALL");

  const handleSave = async (form) => {
    setSaving(true);
    try {
      const platform = modal.dest?.platform || genPlatformKey();
      await upsertDest({...form, platform, custom: true});
      setModal(null);
      await refresh();
    } catch (e) {
      alert("Save failed: " + (e.response?.data?.message || e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (platform) => {
    try {await deleteDest(platform); await refresh();}
    catch (e) {alert("Delete failed: " + (e.response?.data?.message || e.message));}
  };

  const handleToggle = async (dest) => {
    try {await upsertDest({...dest, enabled: !dest.enabled}); await refresh();}
    catch (e) {alert("Toggle failed: " + (e.response?.data?.message || e.message));}
  };

  return (
    <div style={{background: BG, color: BODY, ...syne}}>

      {/* ── Control bar: filters + actions ── */}
      <div style={{
        background: CARD, borderBottom: `1px solid ${BORDER}`,
        padding: "12px 32px", display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 12,
        boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
      }}>
        <div style={{display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap"}}>
          <div role="group" aria-label="Filter by stream status" style={{display: "flex", alignItems: "center", gap: 6}}>
            <span style={{...mono, fontSize: 10, color: MUTED, letterSpacing: "0.1em", marginRight: 2}}>STATUS</span>
            {FILTER_STATUS.map(f => (
              <button key={f} onClick={() => setStatusFilter(f)} aria-pressed={statusFilter === f} style={pillStyle(statusFilter === f)}>{f}</button>
            ))}
          </div>
          <div aria-hidden="true" style={{width: 1, height: 20, background: BORDER}}/>
          <div role="group" aria-label="Filter by enabled state" style={{display: "flex", alignItems: "center", gap: 6}}>
            <span style={{...mono, fontSize: 10, color: MUTED, letterSpacing: "0.1em", marginRight: 2}}>STATE</span>
            {FILTER_ENABLED.map(f => (
              <button key={f} onClick={() => setEnabledFilter(f)} aria-pressed={enabledFilter === f} style={pillStyle(enabledFilter === f)}>{f}</button>
            ))}
          </div>
        </div>
        <div style={{display: "flex", alignItems: "center", gap: 12}}>
          {lastRefresh && (
            <span aria-live="polite" style={{...mono, fontSize: 10, color: MUTED}}>
              ↺ {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <Btn variant="dim" onClick={() => refresh(true)}>Refresh</Btn>
          <Btn variant="primary" onClick={() => setModal({mode: "add"})}>+ Add Destination</Btn>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div style={{background: CARD, borderBottom: `1px solid ${BORDER}`, padding: "9px 32px", display: "flex", gap: 28}}>
        {[
          ["DESTINATIONS", destList.length],
          ["LIVE NOW",     streams.filter(s => s.ready).length],
          ["ENABLED",      destList.filter(d => d.enabled).length],
          ...(isFiltered ? [["FILTERED", filtered.length]] : []),
        ].map(([k, v]) => (
          <div key={k} style={{display: "flex", alignItems: "center", gap: 7}}>
            <span style={{...mono, fontSize: 10, color: MUTED, letterSpacing: "0.1em"}}>{k}</span>
            <span style={{...mono, fontSize: 15, fontWeight: 600, color: v > 0 ? ACCENT : SECOND}}>{v}</span>
          </div>
        ))}
      </div>

      {/* ── Body ── */}
      <main style={{padding: "28px 32px", maxWidth: 820, margin: "0 auto"}}>
        {loading ? (
          <div role="status" aria-label="Loading" style={{textAlign: "center", padding: 72, ...mono, fontSize: 12, color: MUTED, letterSpacing: "0.15em"}}>
            LOADING…
          </div>
        ) : error ? (
          <div role="alert" style={{
            background: "#fef2f2", border: "1px solid #fca5a5",
            borderRadius: 8, padding: 28, textAlign: "center",
          }}>
            <div style={{...mono, fontSize: 13, color: DANGER, marginBottom: 10}}>⚠ {error}</div>
            <div style={{fontSize: 12, color: SECOND, marginBottom: 18}}>
              Check that you are signed in and this page is served from the same domain as Oryx.
            </div>
            <Btn variant="primary" onClick={() => refresh(true)}>Retry</Btn>
          </div>
        ) : (
          <>
            <SearchFilterBar
              query={query}           setQuery={setQuery}
              total={destList.length} shown={filtered.length}
            />
            {filtered.length === 0 ? (
              <EmptyState filtered={isFiltered} onAdd={() => setModal({mode: "add"})} onClear={clearFilters}/>
            ) : (
              <div style={{display: "flex", flexDirection: "column", gap: 10}}>
                {filtered.map(dest => (
                  <DestCard
                    key={dest.platform}
                    dest={dest}
                    stream={streamMap[dest.platform]}
                    onEdit={(d) => setModal({mode: "edit", dest: d})}
                    onDelete={handleDelete}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {modal && (
        <DestModal
          initial={modal.dest}
          saving={saving}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
