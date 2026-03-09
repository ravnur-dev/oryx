//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
import {Badge, Button, Form, Table} from "react-bootstrap";
import React from "react";
import {Token} from "../utils";
import axios from "axios";
import {useErrorHandler} from "react-error-boundary";

const ROLES = ['owner', 'editor'];

const emptyForm = {firstName: '', lastName: '', email: '', role: 'editor'};

export default function Users() {
  const [users, setUsers] = React.useState([]);
  const [form, setForm] = React.useState(emptyForm);
  const [editingId, setEditingId] = React.useState(null); // null = add mode, string = edit mode
  const [showForm, setShowForm] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const handleError = useErrorHandler();

  const loadUsers = React.useCallback(() => {
    axios.post('/terraform/v1/mgmt/users', {}, {
      headers: Token.loadBearerHeader(),
    }).then(res => {
      setUsers(res.data.data || []);
    }).catch(handleError);
  }, [handleError]);

  React.useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openAddForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (user) => {
    setEditingId(user.id);
    setForm({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
    });
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const submitForm = (e) => {
    e.preventDefault();
    if (!form.firstName.trim()) return alert('First name is required.');
    if (!form.lastName.trim()) return alert('Last name is required.');
    if (!form.email.trim()) return alert('Email is required.');
    if (!ROLES.includes(form.role)) return alert('Role must be owner or editor.');

    setSubmitting(true);
    const payload = {
      action: editingId ? 'update' : 'create',
      ...(editingId ? {id: editingId} : {}),
      callerEmail: Token.loadUser()?.email || '',
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      role: form.role,
    };

    axios.post('/terraform/v1/mgmt/users', payload, {
      headers: Token.loadBearerHeader(),
    }).then(() => {
      cancelForm();
      loadUsers();
    }).catch(handleError).finally(() => setSubmitting(false));
  };

  const deleteUser = (user) => {
    if (!window.confirm(`Delete ${user.firstName} ${user.lastName} (${user.email})?`)) return;

    axios.post('/terraform/v1/mgmt/users', {
      action: 'delete',
      id: user.id,
      callerEmail: Token.loadUser()?.email || '',
    }, {
      headers: Token.loadBearerHeader(),
    }).then(() => {
      loadUsers();
    }).catch(handleError);
  };

  return (
    <div>
      <h4>User Management</h4>
      <p className="text-muted">
        Manage users who can access the simulcasting management application.
        <strong> Owners</strong> can add, edit, and delete users.
        <strong> Editors</strong> can manage forwarding destinations but cannot manage users.
      </p>

      {!showForm && (
        <Button variant="primary" className="mb-3" onClick={openAddForm}>
          Add User
        </Button>
      )}

      {showForm && (
        <div className="border rounded p-3 mb-3 bg-light">
          <h5>{editingId ? 'Edit User' : 'Add User'}</h5>
          <Form onSubmit={submitForm}>
            <div className="row g-2 mb-2">
              <div className="col-md-3">
                <Form.Label>First Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="First name"
                  value={form.firstName}
                  onChange={e => setForm({...form, firstName: e.target.value})}
                />
              </div>
              <div className="col-md-3">
                <Form.Label>Last Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Last name"
                  value={form.lastName}
                  onChange={e => setForm({...form, lastName: e.target.value})}
                />
              </div>
              <div className="col-md-4">
                <Form.Label>Email</Form.Label>
                <Form.Control
                  type="email"
                  placeholder="user@example.com"
                  value={form.email}
                  onChange={e => setForm({...form, email: e.target.value})}
                />
              </div>
              <div className="col-md-2">
                <Form.Label>Role</Form.Label>
                <Form.Select
                  value={form.role}
                  onChange={e => setForm({...form, role: e.target.value})}
                >
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                </Form.Select>
              </div>
            </div>
            <Button variant="primary" type="submit" disabled={submitting} className="me-2">
              {editingId ? 'Save Changes' : 'Create User'}
            </Button>
            <Button variant="secondary" onClick={cancelForm} disabled={submitting}>
              Cancel
            </Button>
          </Form>
        </div>
      )}

      {users.length === 0 ? (
        <p className="text-muted">No users yet. Add the first user above.</p>
      ) : (
        <Table striped bordered hover>
          <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
          </thead>
          <tbody>
          {users.map(user => (
            <tr key={user.id} style={{verticalAlign: 'middle'}}>
              <td>{user.firstName} {user.lastName}</td>
              <td>{user.email}</td>
              <td>
                <Badge bg={user.role === 'owner' ? 'primary' : 'secondary'}>
                  {user.role}
                </Badge>
              </td>
              <td>{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : ''}</td>
              <td>
                <Button
                  variant="outline-primary"
                  size="sm"
                  className="me-2"
                  onClick={() => openEditForm(user)}
                >
                  Edit
                </Button>
                <Button
                  variant="outline-danger"
                  size="sm"
                  onClick={() => deleteUser(user)}
                >
                  Delete
                </Button>
              </td>
            </tr>
          ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
