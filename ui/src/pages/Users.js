//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
import React from "react";
import axios from "axios";
import {Link, useLocation} from "react-router-dom";
import {Token} from "../utils";
import {useErrorHandler} from "react-error-boundary";
import {SrsErrorBoundary} from "../components/SrsErrorBoundary";

export default function Users() {
  return (
    <SrsErrorBoundary>
      <UsersImpl/>
    </SrsErrorBoundary>
  );
}

// ── Design tokens (matches ForwardManager) ────────────────────────────────────
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

// ── Nav + action bar ──────────────────────────────────────────────────────────
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

function NavBar({onAdd}) {
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
        <Btn variant="primary" onClick={onAdd}>+ Add User</Btn>
      </div>
    </div>
  );
}

// ── User row card ─────────────────────────────────────────────────────────────
function UserCard({user, onEdit, onDelete}) {
  const [confirmDel, setConfirmDel] = React.useState(false);
  const isOwner = user.role === 'owner';

  return (
    <article style={{
      background: CARD,
      borderRadius: 8,
      padding: "18px 22px",
      border: `1px solid ${BORDER}`,
      borderLeft: `3px solid ${isOwner ? ACCENT : "#c8c4be"}`,
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    }}>
      <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12}}>
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{...syne, fontWeight: 700, fontSize: 14, color: HEADING, marginBottom: 2}}>
            {user.firstName} {user.lastName}
          </div>
          <div style={{...mono, fontSize: 11, color: MUTED}}>
            {user.email}
          </div>
        </div>

        <div style={{display: "flex", alignItems: "center", gap: 10, flexShrink: 0}}>
          <span style={{
            ...mono, fontSize: 10, letterSpacing: "0.08em",
            color: isOwner ? ACCENT : SECOND,
            background: isOwner ? "rgba(181,65,0,0.08)" : PANEL,
            border: `1px solid ${isOwner ? "rgba(181,65,0,0.25)" : BORDER}`,
            padding: "2px 8px", borderRadius: 3,
          }}>
            {user.role.toUpperCase()}
          </span>

          {user.createdAt && (
            <span style={{...mono, fontSize: 10, color: MUTED}}>
              {new Date(user.createdAt).toLocaleDateString()}
            </span>
          )}

          <button
            onClick={() => onEdit(user)}
            aria-label={`Edit ${user.firstName} ${user.lastName}`}
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
            aria-label={`Delete ${user.firstName} ${user.lastName}`}
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

      {confirmDel && (
        <div role="alertdialog" aria-label="Confirm deletion" style={{
          marginTop: 14, padding: "14px 16px", borderRadius: 6,
          background: "#fef2f2", border: "1px solid #fca5a5",
        }}>
          <div style={{...syne, fontSize: 13, color: DANGER, marginBottom: 10}}>
            Delete {user.firstName} {user.lastName} ({user.email})? This cannot be undone.
          </div>
          <div style={{display: "flex", gap: 8}}>
            <Btn variant="ghost" small onClick={() => setConfirmDel(false)}>Cancel</Btn>
            <Btn variant="danger" small onClick={() => {setConfirmDel(false); onDelete(user);}}>Delete</Btn>
          </div>
        </div>
      )}
    </article>
  );
}

// ── Add / Edit Modal ──────────────────────────────────────────────────────────
const ROLES = ['owner', 'editor'];
const emptyForm = {firstName: '', lastName: '', email: '', role: 'editor'};

function UserModal({initial, onSave, onClose, saving}) {
  const [form, setForm] = React.useState(initial
    ? {firstName: initial.firstName, lastName: initial.lastName, email: initial.email, role: initial.role}
    : emptyForm
  );
  const set = (k) => (e) => setForm(f => ({...f, [k]: e.target.value}));
  const valid = form.firstName.trim() && form.lastName.trim() && form.email.trim();

  React.useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={initial ? "Edit user" : "New user"}
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
            {initial ? "Edit User" : "New User"}
          </span>
        </div>

        {[
          {label: "First Name", key: "firstName", ph: "Jane",              type: "text"},
          {label: "Last Name",  key: "lastName",  ph: "Smith",             type: "text"},
          {label: "Email",      key: "email",     ph: "jane@example.com",  type: "email"},
        ].map(({label, key, ph, type}) => (
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

        <div style={{marginBottom: 28}}>
          <label
            htmlFor="field-role"
            style={{
              display: "block", ...mono, fontSize: 10, color: MUTED,
              letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7,
            }}>Role</label>
          <div style={{display: "flex", gap: 8}}>
            {ROLES.map(r => (
              <button
                key={r}
                onClick={() => setForm(f => ({...f, role: r}))}
                style={{
                  ...syne, fontSize: 12, fontWeight: 600, letterSpacing: "0.06em",
                  padding: "7px 20px", borderRadius: 5, cursor: "pointer",
                  border: "1.5px solid",
                  background:  form.role === r ? ACCENT       : "transparent",
                  color:       form.role === r ? "#ffffff"    : SECOND,
                  borderColor: form.role === r ? ACCENT       : BORDER,
                  transition: "all 0.15s",
                }}
              >
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={{display: "flex", gap: 10, justifyContent: "flex-end"}}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={!valid || saving} onClick={() => valid && onSave(form)}>
            {saving ? "Saving…" : "Save User"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────
function UsersImpl() {
  const [users,   setUsers]   = React.useState([]);
  const [modal,   setModal]   = React.useState(null); // null | {mode:'add'} | {mode:'edit', user}
  const [saving,  setSaving]  = React.useState(false);
  const handleError = useErrorHandler();

  const loadUsers = React.useCallback(() => {
    axios.post('/terraform/v1/mgmt/users', {}, {
      headers: Token.loadBearerHeader(),
    }).then(res => {
      setUsers(res.data.data || []);
    }).catch(handleError);
  }, [handleError]);

  React.useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleSave = (form) => {
    if (!form.firstName.trim()) return alert('First name is required.');
    if (!form.lastName.trim())  return alert('Last name is required.');
    if (!form.email.trim())     return alert('Email is required.');
    if (!ROLES.includes(form.role)) return alert('Role must be owner or editor.');

    setSaving(true);
    const payload = {
      action: modal.user ? 'update' : 'create',
      ...(modal.user ? {id: modal.user.id} : {}),
      callerEmail: Token.loadUser()?.email || '',
      firstName: form.firstName.trim(),
      lastName:  form.lastName.trim(),
      email:     form.email.trim(),
      role:      form.role,
    };

    axios.post('/terraform/v1/mgmt/users', payload, {
      headers: Token.loadBearerHeader(),
    }).then(() => {
      setModal(null);
      loadUsers();
    }).catch(handleError).finally(() => setSaving(false));
  };

  const handleDelete = (user) => {
    axios.post('/terraform/v1/mgmt/users', {
      action: 'delete',
      id: user.id,
      callerEmail: Token.loadUser()?.email || '',
    }, {headers: Token.loadBearerHeader()}).then(loadUsers).catch(handleError);
  };

  const owners  = users.filter(u => u.role === 'owner').length;
  const editors = users.filter(u => u.role === 'editor').length;

  return (
    <div style={{background: BG, color: BODY, ...syne}}>

      {/* ── Nav + action bar ── */}
      <NavBar onAdd={() => setModal({mode: 'add'})}/>

      {/* ── Stats bar ── */}
      <div style={{background: CARD, borderBottom: `1px solid ${BORDER}`, padding: "9px 32px", display: "flex", gap: 28}}>
        {[
          ["TOTAL",   users.length],
          ["OWNERS",  owners],
          ["EDITORS", editors],
        ].map(([k, v]) => (
          <div key={k} style={{display: "flex", alignItems: "center", gap: 7}}>
            <span style={{...mono, fontSize: 10, color: MUTED, letterSpacing: "0.1em"}}>{k}</span>
            <span style={{...mono, fontSize: 15, fontWeight: 600, color: v > 0 ? ACCENT : SECOND}}>{v}</span>
          </div>
        ))}
      </div>

      {/* ── Body ── */}
      <main style={{padding: "28px 32px", maxWidth: 820, margin: "0 auto"}}>
        {users.length === 0 ? (
          <div style={{textAlign: "center", padding: "56px 24px"}}>
            <div aria-hidden="true" style={{fontSize: 40, marginBottom: 14, color: BORDER}}>⬡</div>
            <div style={{...syne, fontSize: 15, color: SECOND, marginBottom: 6}}>No users yet</div>
            <div style={{fontSize: 12, color: MUTED, marginBottom: 20}}>Add the first user to grant access to this application</div>
            <Btn variant="primary" onClick={() => setModal({mode: 'add'})}>+ Add User</Btn>
          </div>
        ) : (
          <div style={{display: "flex", flexDirection: "column", gap: 10}}>
            {users.map(user => (
              <UserCard
                key={user.id}
                user={user}
                onEdit={(u) => setModal({mode: 'edit', user: u})}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      {modal && (
        <UserModal
          initial={modal.user}
          saving={saving}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
