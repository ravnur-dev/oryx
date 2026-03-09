//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
import React from "react";
import axios from "axios";
import {Link, useLocation} from "react-router-dom";
import {Token} from "../utils";
import {SrsErrorBoundary} from "../components/SrsErrorBoundary";

export default function Streams() {
  return (
    <SrsErrorBoundary>
      <StreamsImpl />
    </SrsErrorBoundary>
  );
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiPost(path, body = {}) {
  const res = await axios.post(path, body, {headers: Token.loadBearerHeader()});
  if (res.data.code !== 0) throw new Error(res.data.message || `API error code ${res.data.code}`);
  return res.data;
}

async function apiGet(path) {
  const res = await axios.get(path, {headers: Token.loadBearerHeader()});
  if (res.data.code !== 0) throw new Error(`API error code ${res.data.code}`);
  return res.data;
}

const queryStreams  = () => apiPost("/terraform/v1/mgmt/streams/query");
const querySrsStats = () => apiGet("/api/v1/streams");
const kickoffStream = (s) => apiPost("/terraform/v1/mgmt/streams/kickoff", {
  vhost: s.vhost, app: s.app, stream: s.stream,
});

// ── localStorage helpers ──────────────────────────────────────────────────────
const descKey  = (name) => `stream_desc_${name}`;
const loadDesc = (name) => { try { return localStorage.getItem(descKey(name)) || ""; } catch { return ""; } };
const saveDesc = (name, desc) => { try { desc.trim() ? localStorage.setItem(descKey(name), desc.trim()) : localStorage.removeItem(descKey(name)); } catch {} };

// ── Design tokens ─────────────────────────────────────────────────────────────
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

function Dot({active}) {
  return (
    <span aria-hidden="true" style={{
      display: "inline-block", width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
      background: active ? ACCENT : "#b0aca8",
      boxShadow: active ? `0 0 0 3px rgba(181,65,0,0.15)` : "none",
      transition: "all 0.4s",
    }}/>
  );
}

const pillStyle = (active) => ({
  ...{fontFamily: "'Public Sans', sans-serif"}, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
  padding: "4px 12px", borderRadius: 3, cursor: "pointer", border: "1.5px solid",
  transition: "all 0.15s",
  background:  active ? ACCENT    : "transparent",
  color:       active ? "#ffffff" : SECOND,
  borderColor: active ? ACCENT    : BORDER,
});

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, "0")).join(":");
}

// ── Nav bar ───────────────────────────────────────────────────────────────────
const ALL_NAV_ITEMS = [
  {to: '/routers-forward',    text: 'Forward'},
  {to: '/routers-streams',    text: 'Streams'},
  {to: '/routers-scenario',   text: 'Scenario',   ownerOnly: true},
  {to: '/routers-settings',   text: 'System',     ownerOnly: true},
  {to: '/routers-components', text: 'Components', ownerOnly: true},
  {to: '/routers-contact',    text: 'Contact',    ownerOnly: true},
  {to: '/routers-users',      text: 'Users',      ownerOnly: true},
  {to: '/routers-logout',     text: 'Logout'},
];

function NavBar({lastRefresh, onRefresh}) {
  const location = useLocation();
  const user = Token.loadUser();
  const isOwner = !user || user.role === 'owner';
  const items = ALL_NAV_ITEMS.filter(e => !e.ownerOnly || isOwner);

  return (
    <div style={{
      background: CARD, borderBottom: `1px solid ${BORDER}`,
      padding: "0 32px", display: "flex", alignItems: "stretch",
      justifyContent: "space-between",
      boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
    }}>
      <nav style={{display: "flex", alignItems: "stretch", gap: 2}}>
        {items.map(item => {
          const active = location.pathname.includes(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              style={{
                ...syne, fontSize: 12, fontWeight: active ? 700 : 500,
                color: active ? ACCENT : SECOND,
                textDecoration: "none",
                padding: "14px 14px 12px",
                borderBottom: active ? `2px solid ${ACCENT}` : "2px solid transparent",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.color = HEADING; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.color = SECOND; }}
            >
              {item.text}
            </Link>
          );
        })}
      </nav>
      <div style={{display: "flex", alignItems: "center", gap: 12, paddingLeft: 16}}>
        {lastRefresh && (
          <span aria-live="polite" style={{...mono, fontSize: 10, color: MUTED}}>
            ↺ {lastRefresh.toLocaleTimeString()}
          </span>
        )}
        <Btn variant="dim" onClick={onRefresh}>Refresh</Btn>
      </div>
    </div>
  );
}

// ── Search + Filter bar ───────────────────────────────────────────────────────
const FILTER_STATUS = ["ALL", "ACTIVE", "DISCONNECTED"];

function SearchFilterBar({query, setQuery, statusFilter, setStatusFilter, total, shown}) {
  return (
    <div style={{
      background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8,
      padding: "14px 20px", marginBottom: 20,
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{position: "relative"}}>
        <span aria-hidden="true" style={{
          position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
          ...mono, fontSize: 14, color: MUTED, pointerEvents: "none", lineHeight: 1,
        }}>⌕</span>
        <input
          type="search"
          aria-label="Search streams"
          placeholder="Search by stream name or description…"
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
      <div style={{display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap"}}>
        <div role="group" aria-label="Filter by status" style={{display: "flex", alignItems: "center", gap: 6}}>
          <span style={{...mono, fontSize: 10, color: MUTED, letterSpacing: "0.1em", marginRight: 2}}>STATUS</span>
          {FILTER_STATUS.map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} aria-pressed={statusFilter === f} style={pillStyle(statusFilter === f)}>{f}</button>
          ))}
        </div>
        <div style={{marginLeft: "auto", ...mono, fontSize: 11, color: MUTED}}>
          {shown < total
            ? <><span style={{color: ACCENT}}>{shown}</span> / {total} streams</>
            : <><span style={{color: ACCENT}}>{total}</span> streams</>
          }
        </div>
      </div>
    </div>
  );
}

// ── Stream Card ───────────────────────────────────────────────────────────────
function StreamCard({entry, onReset, onPreview, onEdit}) {
  const [confirmReset, setConfirmReset] = React.useState(false);
  const {stream, active, srsStats} = entry;
  const name = stream.stream; // without "live/" prefix
  const desc = loadDesc(name);

  const bitrate = srsStats?.kbps?.recv_30s;
  const uptimeMs = srsStats?.live_ms;

  return (
    <article style={{
      background: CARD,
      borderRadius: 8,
      padding: "18px 22px",
      border: `1px solid ${BORDER}`,
      borderLeft: `3px solid ${active ? ACCENT : "#c8c4be"}`,
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      transition: "box-shadow 0.2s",
    }}>
      <div style={{display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12}}>
        <div style={{display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0}}>
          <Dot active={active}/>
          <div style={{minWidth: 0, flex: 1}}>
            <div style={{...syne, fontWeight: 700, fontSize: 14, color: HEADING, marginBottom: desc ? 2 : 0}}>
              {name}
            </div>
            {desc && (
              <div style={{...mono, fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>
                {desc}
              </div>
            )}
          </div>
        </div>

        <div style={{display: "flex", alignItems: "center", gap: 8, flexShrink: 0}}>
          <span style={{
            ...mono, fontSize: 10, letterSpacing: "0.08em",
            color: active ? ACCENT : SECOND,
            background: active ? "rgba(181,65,0,0.08)" : PANEL,
            border: `1px solid ${active ? "rgba(181,65,0,0.25)" : BORDER}`,
            padding: "2px 8px", borderRadius: 3,
          }}>
            {active ? "● ACTIVE" : "○ DISCONNECTED"}
          </span>

          {/* Preview button */}
          <button
            onClick={() => onPreview(stream)}
            aria-label={`Preview ${name}`}
            title="Watch stream"
            style={{
              background: "none", border: "1px solid transparent", color: SECOND,
              cursor: "pointer", fontSize: 15, padding: "3px 6px", lineHeight: 1,
              borderRadius: 4, transition: "all 0.15s",
            }}
            onMouseEnter={e => {e.currentTarget.style.color = HEADING; e.currentTarget.style.background = PANEL; e.currentTarget.style.borderColor = BORDER;}}
            onMouseLeave={e => {e.currentTarget.style.color = SECOND;  e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "transparent";}}
          >▶</button>

          {/* Edit description button */}
          <button
            onClick={() => onEdit(stream)}
            aria-label={`Edit description for ${name}`}
            title="Edit description"
            style={{
              background: "none", border: "1px solid transparent", color: SECOND,
              cursor: "pointer", fontSize: 15, padding: "3px 6px", lineHeight: 1,
              borderRadius: 4, transition: "all 0.15s",
            }}
            onMouseEnter={e => {e.currentTarget.style.color = HEADING; e.currentTarget.style.background = PANEL; e.currentTarget.style.borderColor = BORDER;}}
            onMouseLeave={e => {e.currentTarget.style.color = SECOND;  e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "transparent";}}
          >✎</button>

          {/* Reset button — only when active */}
          {active && (
            <button
              onClick={() => setConfirmReset(true)}
              aria-label={`Reset ${name}`}
              title="Disconnect stream (encoder will reconnect)"
              style={{
                background: "none", border: "1px solid transparent", color: SECOND,
                cursor: "pointer", fontSize: 14, padding: "3px 6px", lineHeight: 1,
                borderRadius: 4, transition: "all 0.15s",
              }}
              onMouseEnter={e => {e.currentTarget.style.color = DANGER; e.currentTarget.style.background = "#fef2f2"; e.currentTarget.style.borderColor = "#fca5a5";}}
              onMouseLeave={e => {e.currentTarget.style.color = SECOND; e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "transparent";}}
            >⟳</button>
          )}
        </div>
      </div>

      {/* Stats row — active streams only */}
      {active && (bitrate || uptimeMs) && (
        <div style={{display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10}}>
          {bitrate && (
            <span style={{
              ...mono, fontSize: 10, color: ACCENT,
              background: "rgba(181,65,0,0.06)", border: "1px solid rgba(181,65,0,0.2)",
              padding: "2px 8px", borderRadius: 3, letterSpacing: "0.06em",
            }}>
              <span style={{color: MUTED, marginRight: 5}}>BITRATE</span>{bitrate} kbps
            </span>
          )}
          {uptimeMs && (
            <span style={{
              ...mono, fontSize: 10, color: ACCENT,
              background: "rgba(181,65,0,0.06)", border: "1px solid rgba(181,65,0,0.2)",
              padding: "2px 8px", borderRadius: 3, letterSpacing: "0.06em",
            }}>
              <span style={{color: MUTED, marginRight: 5}}>UPTIME</span>{formatUptime(uptimeMs)}
            </span>
          )}
        </div>
      )}

      {/* Inline reset confirmation */}
      {confirmReset && (
        <div role="alertdialog" aria-label="Confirm reset" style={{
          marginTop: 14, padding: "14px 16px", borderRadius: 6,
          background: "#fef2f2", border: "1px solid #fca5a5",
        }}>
          <div style={{...syne, fontSize: 13, color: DANGER, marginBottom: 10}}>
            Disconnect "{name}"? The encoder will reconnect automatically.
          </div>
          <div style={{display: "flex", gap: 8}}>
            <Btn variant="ghost" small onClick={() => setConfirmReset(false)}>Cancel</Btn>
            <Btn variant="danger" small onClick={() => {setConfirmReset(false); onReset(stream);}}>Reset</Btn>
          </div>
        </div>
      )}
    </article>
  );
}

// ── Preview Modal ─────────────────────────────────────────────────────────────
function PreviewModal({stream, onClose}) {
  const name = stream.stream;
  const flvUrl = `${window.location.origin}/live/${name}.flv`;
  const playerUrl = `/tools/player.html?url=${encodeURIComponent(flvUrl)}`;

  React.useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${name}`}
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed", inset: 0, background: "rgba(43,41,38,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, backdropFilter: "blur(4px)",
      }}>
      <div style={{
        background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10,
        padding: "28px 32px", width: 520, maxWidth: "92vw",
        boxShadow: "0 24px 60px rgba(0,0,0,0.18)",
      }}>
        <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18}}>
          <div style={{display: "flex", alignItems: "center", gap: 12}}>
            <div style={{width: 5, height: 28, background: ACCENT, borderRadius: 3}}/>
            <span style={{...syne, fontWeight: 800, fontSize: 18, color: HEADING}}>{name}</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close preview"
            style={{
              background: "none", border: "none", color: MUTED, cursor: "pointer",
              fontSize: 20, lineHeight: 1, padding: "4px 8px",
            }}>✕</button>
        </div>
        <iframe
          src={playerUrl}
          title={`Live preview: ${name}`}
          style={{
            width: "100%", height: 260, border: `1px solid ${BORDER}`,
            borderRadius: 6, display: "block", background: "#000",
          }}
          allowFullScreen
        />
        <div style={{...mono, fontSize: 10, color: MUTED, marginTop: 10, wordBreak: "break-all"}}>
          {flvUrl}
        </div>
      </div>
    </div>
  );
}

// ── Edit Description Modal ────────────────────────────────────────────────────
const MAX_WORDS = 50;

function countWords(text) {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

function EditModal({stream, onSave, onClose}) {
  const name = stream.stream;
  const [text, setText] = React.useState(loadDesc(name));
  const words = countWords(text);
  const over = words > MAX_WORDS;

  React.useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const handleSave = () => {
    if (over) return;
    saveDesc(name, text);
    onSave();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit description for ${name}`}
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
        <div style={{display: "flex", alignItems: "center", gap: 12, marginBottom: 24}}>
          <div style={{width: 5, height: 28, background: ACCENT, borderRadius: 3}}/>
          <span style={{...syne, fontWeight: 800, fontSize: 18, color: HEADING}}>
            Edit Description — {name}
          </span>
        </div>

        <div style={{marginBottom: 24}}>
          <label
            htmlFor="stream-desc"
            style={{display: "block", ...mono, fontSize: 10, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7}}>
            Description <span style={{fontWeight: 400, textTransform: "none", letterSpacing: 0}}>— optional</span>
          </label>
          <textarea
            id="stream-desc"
            rows={4}
            maxLength={500}
            spellCheck={true}
            placeholder="Add a short description for this stream…"
            value={text}
            onChange={e => setText(e.target.value)}
            style={{
              ...inputBase, padding: "9px 12px", resize: "vertical",
              borderColor: over ? DANGER : BORDER,
            }}
            onFocus={e => (e.target.style.borderColor = over ? DANGER : ACCENT)}
            onBlur={e  => (e.target.style.borderColor = over ? DANGER : BORDER)}
          />
          <div style={{display: "flex", justifyContent: "space-between", marginTop: 5}}>
            <span style={{...mono, fontSize: 10, color: MUTED}}>
              {text.trim() ? "Clear the field to remove the description." : "Leave blank to remove the description."}
            </span>
            <span style={{...mono, fontSize: 10, color: over ? DANGER : MUTED}}>
              {words} / {MAX_WORDS} words
            </span>
          </div>
        </div>

        <div style={{display: "flex", gap: 10, justifyContent: "flex-end"}}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={over} onClick={handleSave}>Save Description</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({filtered, onClear}) {
  return (
    <div style={{textAlign: "center", padding: "56px 24px"}}>
      <div aria-hidden="true" style={{fontSize: 40, marginBottom: 14, color: BORDER}}>
        {filtered ? "⌕" : "⬡"}
      </div>
      <div style={{...syne, fontSize: 15, color: SECOND, marginBottom: 6}}>
        {filtered ? "No matching streams" : "No active streams"}
      </div>
      <div style={{fontSize: 12, color: MUTED, marginBottom: 20}}>
        {filtered ? "Try adjusting your search or filters" : "Streams will appear here when an encoder connects"}
      </div>
      {filtered && <Btn variant="ghost" onClick={onClear}>Clear Filters</Btn>}
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────
function StreamsImpl() {
  // history: Map<"app/stream", {stream: SrsStream, active: bool, srsStats: obj|null}>
  const [history, setHistory]       = React.useState(new Map());
  const [loading, setLoading]       = React.useState(true);
  const [error, setError]           = React.useState(null);
  const [lastRefresh, setLastRefresh] = React.useState(null);
  const [query, setQuery]           = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("ALL");
  const [modal, setModal]           = React.useState(null); // {type: "preview"|"edit", stream}
  const [descTick, setDescTick]     = React.useState(0);   // force re-render after desc save
  const timerRef = React.useRef();

  const refresh = React.useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const [qRes, srsRes] = await Promise.allSettled([queryStreams(), querySrsStats()]);

      const activeStreams = qRes.status === "fulfilled" ? (qRes.value.data?.streams || []) : [];

      // Build SRS stats map keyed by "app/name"
      const srsMap = {};
      if (srsRes.status === "fulfilled") {
        for (const s of (srsRes.value.streams || [])) {
          srsMap[`${s.app}/${s.name}`] = s;
        }
      }

      setHistory(prev => {
        const next = new Map(prev);

        // Mark all existing entries inactive
        for (const [k, v] of next) {
          next.set(k, {...v, active: false, srsStats: null});
        }

        // Upsert active streams
        for (const s of activeStreams) {
          const key = `${s.app}/${s.stream}`;
          const srsStats = srsMap[`${s.app}/${s.stream}`] || null;
          next.set(key, {stream: s, active: true, srsStats});
        }

        return next;
      });

      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh(true);
    timerRef.current = setInterval(() => refresh(false), 5000);
    return () => clearInterval(timerRef.current);
  }, [refresh]);

  const handleReset = async (stream) => {
    try { await kickoffStream(stream); await refresh(); }
    catch (e) { alert("Reset failed: " + e.message); }
  };

  const entries = Array.from(history.values());
  const activeCount = entries.filter(e => e.active).length;
  const disconnected = entries.filter(e => !e.active).length;

  const filtered = entries.filter(entry => {
    const name = entry.stream.stream;
    const desc = loadDesc(name);
    if (statusFilter === "ACTIVE"       && !entry.active) return false;
    if (statusFilter === "DISCONNECTED" &&  entry.active) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      if (!name.toLowerCase().includes(q) && !desc.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Sort: active first, then alphabetical
  filtered.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.stream.stream.localeCompare(b.stream.stream);
  });

  const isFiltered = !!(query || statusFilter !== "ALL");
  const clearFilters = () => { setQuery(""); setStatusFilter("ALL"); };

  return (
    <div style={{background: BG, color: BODY, ...syne}}>

      {/* ── Nav bar ── */}
      <NavBar lastRefresh={lastRefresh} onRefresh={() => refresh(true)}/>

      {/* ── Stats bar ── */}
      <div style={{background: CARD, borderBottom: `1px solid ${BORDER}`, padding: "9px 32px", display: "flex", gap: 28}}>
        {[
          ["STREAMS",      entries.length],
          ["ACTIVE",       activeCount],
          ["DISCONNECTED", disconnected],
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
          <div role="status" style={{textAlign: "center", padding: 72, ...mono, fontSize: 12, color: MUTED, letterSpacing: "0.15em"}}>
            LOADING…
          </div>
        ) : error ? (
          <div role="alert" style={{
            background: "#fef2f2", border: "1px solid #fca5a5",
            borderRadius: 8, padding: 28, textAlign: "center",
          }}>
            <div style={{...mono, fontSize: 13, color: DANGER, marginBottom: 10}}>⚠ {error}</div>
            <Btn variant="primary" onClick={() => refresh(true)}>Retry</Btn>
          </div>
        ) : (
          <>
            <SearchFilterBar
              query={query}             setQuery={setQuery}
              statusFilter={statusFilter} setStatusFilter={setStatusFilter}
              total={entries.length}    shown={filtered.length}
            />
            {filtered.length === 0 ? (
              <EmptyState filtered={isFiltered} onClear={clearFilters}/>
            ) : (
              <div style={{display: "flex", flexDirection: "column", gap: 10}}>
                {filtered.map(entry => (
                  <StreamCard
                    key={`${entry.stream.app}/${entry.stream.stream}`}
                    entry={entry}
                    descTick={descTick}
                    onReset={handleReset}
                    onPreview={(s) => setModal({type: "preview", stream: s})}
                    onEdit={(s) => setModal({type: "edit", stream: s})}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {modal?.type === "preview" && (
        <PreviewModal stream={modal.stream} onClose={() => setModal(null)}/>
      )}

      {modal?.type === "edit" && (
        <EditModal
          stream={modal.stream}
          onSave={() => { setDescTick(t => t + 1); setModal(null); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
