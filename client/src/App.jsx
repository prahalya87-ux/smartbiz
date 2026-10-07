import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { ToastContainer, toast } from 'react-toastify';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import 'react-toastify/dist/ReactToastify.css';

// ---------- API helper ----------
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isLoginCall = err.config?.url?.includes('/auth/login');
    if (err.response?.status === 401 && !isLoginCall) {
      localStorage.removeItem('token');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

const getErrorMessage = (err) => err.response?.data?.message || 'Unable to reach the server. Please try again.';

// ---------- Auth context ----------
const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((res) => setUser(res.data.user))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
    return res.data.user;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (_) {
      /* log out locally either way */
    }
    localStorage.removeItem('token');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

// ---------- Route protection ----------
// <ProtectedRoute roles={['ADMIN','MANAGER']}>...</ProtectedRoute>
function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

// ---------- Login + Forgot password ----------
function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const u = await login(form.email, form.password);
      toast.success(`Welcome back, ${u.name}!`);
      navigate(location.state?.from?.pathname || '/dashboard', { replace: true });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container d-flex align-items-center justify-content-center min-vh-100 py-4">
      <div className="card p-4 shadow-sm" style={{ maxWidth: 420, width: '100%' }}>
        <div className="text-center mb-4">
          <i className="bi bi-box-seam fs-1 text-primary" aria-hidden="true"></i>
          <h1 className="h4 mt-2 mb-0">SmartBiz</h1>
          <p className="text-secondary small">Digital Inventory and Sales Management</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label htmlFor="email" className="form-label">Email</label>
            <input id="email" name="email" type="email" className="form-control" required autoFocus
              autoComplete="username" value={form.email} onChange={handleChange} />
          </div>
          <div className="mb-3">
            <label htmlFor="password" className="form-label">Password</label>
            <input id="password" name="password" type="password" className="form-control" required
              autoComplete="current-password" value={form.password} onChange={handleChange} />
          </div>
          <button className="btn btn-primary w-100" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
          <div className="text-center mt-3">
            <Link to="/forgot-password" className="small">Forgot password?</Link>
          </div>
        </form>
        <div className="alert alert-warning small mt-4 mb-0">
          <strong>Development-only demo logins</strong> (never use in production)
          <ul className="mb-0 ps-3">
            <li>admin@smartbiz.com / Admin@123</li>
            <li>manager@smartbiz.com / Manager@123</li>
            <li>cashier@smartbiz.com / Cashier@123</li>
            <li>staff@smartbiz.com / Staff@123</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function ForgotPassword() {
  return (
    <div className="container d-flex align-items-center justify-content-center min-vh-100">
      <div className="card p-4 text-center shadow-sm" style={{ maxWidth: 420, width: '100%' }}>
        <h1 className="h5">Forgot password</h1>
        <p className="text-secondary">
          Email-based password reset is <strong>coming soon</strong>. For now, ask your administrator to reset your password.
        </p>
        <Link to="/login" className="btn btn-primary">Back to sign in</Link>
      </div>
    </div>
  );
}

// ---------- Shared UI helpers ----------
const API_ORIGIN = (api.defaults.baseURL || '').replace(/\/api\/?$/, '');
const MANAGERS = ['ADMIN', 'MANAGER'];
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '-');

function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Loads data from the API; returns { data, loading, error, reload }
function useApi(path, params) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const key = JSON.stringify(params || {});
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    api
      .get(path, { params: JSON.parse(key) })
      .then((res) => setState({ data: res.data, loading: false, error: '' }))
      .catch((err) => setState({ data: null, loading: false, error: getErrorMessage(err) }));
  }, [path, key]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

const Spinner = () => (
  <div className="text-center py-5">
    <div className="spinner-border text-primary" role="status">
      <span className="visually-hidden">Loading...</span>
    </div>
  </div>
);

const Empty = ({ text }) => (
  <div className="text-center text-secondary py-5">
    <i className="bi bi-inbox fs-1" aria-hidden="true"></i>
    <p className="mt-2 mb-0">{text}</p>
  </div>
);

// Shows spinner / error / empty state, otherwise the children
function DataState({ state, isEmpty, emptyText, children }) {
  if (state.loading && !state.data) return <Spinner />;
  if (state.error) return <div className="alert alert-danger m-3">{state.error}</div>;
  if (isEmpty) return <Empty text={emptyText} />;
  return children;
}

function Pagination({ page, pages, onChange }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="py-3">
      <ul className="pagination pagination-sm justify-content-center mb-0">
        <li className={`page-item ${page <= 1 ? 'disabled' : ''}`}>
          <button className="page-link" onClick={() => onChange(page - 1)}>Previous</button>
        </li>
        <li className="page-item disabled"><span className="page-link">Page {page} of {pages}</span></li>
        <li className={`page-item ${page >= pages ? 'disabled' : ''}`}>
          <button className="page-link" onClick={() => onChange(page + 1)}>Next</button>
        </li>
      </ul>
    </nav>
  );
}

function Modal({ title, onClose, children, size = 'lg' }) {
  return (
    <>
      <div className="modal-backdrop fade show"></div>
      <div className="modal fade show d-block" tabIndex="-1" role="dialog" aria-modal="true" onClick={onClose}>
        <div className={`modal-dialog modal-${size} modal-dialog-scrollable`} onClick={(e) => e.stopPropagation()}>
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title h5">{title}</h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose}></button>
            </div>
            <div className="modal-body">{children}</div>
          </div>
        </div>
      </div>
    </>
  );
}

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <Modal title="Please confirm" onClose={onCancel} size="sm">
      <p>{message}</p>
      <div className="d-flex justify-content-end gap-2">
        <button className="btn btn-outline-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn btn-danger" onClick={onConfirm}>Yes, continue</button>
      </div>
    </Modal>
  );
}

function StockBadges({ p }) {
  const low = p.current_stock > 0 && p.current_stock <= p.min_stock_level;
  const expSoon = p.days_left !== null && p.days_left >= 0 && p.days_left <= 30;
  const expired = p.days_left !== null && p.days_left < 0;
  return (
    <>
      {p.current_stock === 0 && <span className="badge bg-danger me-1">Out of stock</span>}
      {low && <span className="badge bg-orange me-1">Low stock</span>}
      {expired && <span className="badge bg-danger me-1">Expired</span>}
      {expSoon && <span className="badge bg-orange me-1">Expires in {p.days_left}d</span>}
      {p.current_stock > p.min_stock_level && !expSoon && !expired && <span className="badge bg-success">OK</span>}
    </>
  );
}

const SEVERITY = { CRITICAL: ['danger', 'Critical'], WARNING: ['orange', 'Warning'], NORMAL: ['success', 'Normal'], INFO: ['primary', 'Info'] };

// ---------- Layout: sidebar + top bar + breadcrumb ----------
const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: 'speedometer2' },
  { to: '/products', label: 'Products', icon: 'box-seam' },
  { to: '/categories', label: 'Categories', icon: 'tags', roles: MANAGERS },
  { to: '/suppliers', label: 'Suppliers', icon: 'truck', roles: MANAGERS },
  { to: '/inventory', label: 'Inventory', icon: 'clipboard-data' },
  { to: '/notifications', label: 'Notifications', icon: 'bell' },
];

function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState('');
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    setOpen(false);
    setMenu(false);
    api.get('/notifications').then((r) => setUnread(r.data.unread)).catch(() => {});
  }, [location.pathname]);

  const current = NAV.find((n) => location.pathname.startsWith(n.to));
  const links = NAV.filter((n) => !n.roles || n.roles.includes(user.role));

  const search = (e) => {
    e.preventDefault();
    navigate(`/products?search=${encodeURIComponent(q)}`);
  };

  return (
    <div>
      <style>{`
        .sidebar{width:230px;min-height:100vh;position:fixed;top:0;left:0;z-index:1030;background:#0b2a5b;transition:transform .2s}
        .sidebar .nav-link{color:#cbd5e1;border-radius:6px}
        .sidebar .nav-link.active{background:#0b3d91;color:#fff}
        .main{margin-left:230px}
        .bg-orange{background:#fd7e14!important;color:#fff}
        @media(max-width:767px){.sidebar{transform:translateX(-100%)}.sidebar.open{transform:none}.main{margin-left:0}}
      `}</style>

      <aside className={`sidebar p-3 ${open ? 'open' : ''}`}>
        <div className="text-white fs-5 fw-semibold mb-4"><i className="bi bi-box-seam me-2"></i>SmartBiz</div>
        <ul className="nav nav-pills flex-column gap-1">
          {links.map((n) => (
            <li key={n.to} className="nav-item">
              <NavLink to={n.to} className="nav-link">
                <i className={`bi bi-${n.icon} me-2`} aria-hidden="true"></i>{n.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </aside>

      <div className="main">
        <header className="bg-white border-bottom px-3 py-2 d-flex align-items-center gap-3">
          <button className="btn btn-outline-secondary d-md-none" aria-label="Open menu" onClick={() => setOpen(!open)}>
            <i className="bi bi-list"></i>
          </button>
          <form className="flex-grow-1" onSubmit={search} role="search">
            <input className="form-control" style={{ maxWidth: 360 }} placeholder="Search products by name, SKU or barcode"
              aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <Link to="/notifications" className="btn btn-outline-secondary position-relative" aria-label="Notifications">
            <i className="bi bi-bell"></i>
            {unread > 0 && <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{unread}</span>}
          </Link>
          <div className="position-relative">
            <button className="btn btn-outline-primary" onClick={() => setMenu(!menu)}>
              <i className="bi bi-person-circle me-1"></i><span className="d-none d-sm-inline">{user.name}</span>
            </button>
            {menu && (
              <div className="card position-absolute end-0 mt-1 p-2" style={{ minWidth: 200, zIndex: 1040 }}>
                <div className="px-2 small text-secondary">{user.email}</div>
                <div className="px-2 mb-2"><span className="badge bg-primary">{user.role}</span></div>
                <button className="btn btn-sm btn-outline-secondary" onClick={logout}>Log out</button>
              </div>
            )}
          </div>
        </header>

        <main className="p-3 p-md-4">
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb">
              <li className="breadcrumb-item"><Link to="/dashboard">Home</Link></li>
              <li className="breadcrumb-item active" aria-current="page">{current ? current.label : ''}</li>
            </ol>
          </nav>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// ---------- Dashboard (more cards and charts arrive in later phases) ----------
function StatCard({ label, value, icon, color = 'primary' }) {
  return (
    <div className="col-6 col-lg-3">
      <div className="card h-100 p-3">
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <div className="text-secondary small">{label}</div>
            <div className="fs-4 fw-semibold">{value}</div>
          </div>
          <i className={`bi bi-${icon} fs-3 text-${color}`} aria-hidden="true"></i>
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const inv = useApi('/inventory');
  const notes = useApi('/notifications');
  const s = inv.data;
  return (
    <>
      <h1 className="h4 mb-3">Dashboard</h1>
      <DataState state={inv}>
        {s && (
          <div className="row g-3 mb-4">
            <StatCard label="Total products" value={s.total_products} icon="box-seam" />
            <StatCard label="Stock value (cost)" value={money(s.stock_value)} icon="cash-stack" color="success" />
            <StatCard label="Low-stock products" value={s.low_stock} icon="exclamation-triangle" color="warning" />
            <StatCard label="Out of stock" value={s.out_of_stock} icon="x-octagon" color="danger" />
            <StatCard label="Expiring in 30 days" value={s.expiring} icon="hourglass-split" color="warning" />
            <StatCard label="Expired" value={s.expired} icon="calendar-x" color="danger" />
          </div>
        )}
      </DataState>
      <div className="card">
        <div className="card-header bg-white fw-semibold">Recent notifications</div>
        <DataState state={notes} isEmpty={notes.data && notes.data.items.length === 0} emptyText="No notifications yet.">
          <ul className="list-group list-group-flush">
            {(notes.data ? notes.data.items.slice(0, 5) : []).map((n) => (
              <li key={n.id} className="list-group-item d-flex align-items-center gap-2">
                <span className={`badge bg-${SEVERITY[n.severity][0]}`}>{SEVERITY[n.severity][1]}</span>
                <span>{n.message}</span>
              </li>
            ))}
          </ul>
        </DataState>
      </div>
    </>
  );
}

// ---------- Generic list + add/edit/delete page (used by Categories and Suppliers) ----------
function CrudPage({ title, endpoint, columns, fields, emptyForm, exampleForm }) {
  const { user } = useAuth();
  const canEdit = MANAGERS.includes(user.role);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const list = useApi(`/${endpoint}`, { search: debounced });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const openForm = (row) => {
    setEditing(row || {});
    setForm(row ? Object.fromEntries(fields.map((f) => [f.name, row[f.name] ?? ''])) : { ...emptyForm });
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing.id) await api.put(`/${endpoint}/${editing.id}`, form);
      else await api.post(`/${endpoint}`, form);
      toast.success('Saved successfully.');
      setEditing(null);
      list.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      const res = await api.delete(`/${endpoint}/${deleting.id}`);
      toast.success(res.data.message);
      list.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(null);
    }
  };

  const rows = list.data || [];
  const fillExample = () => {
    if (!exampleForm) return;
    setForm({ ...emptyForm, ...exampleForm });
    toast.info('Example values filled in. Edit them before saving if needed.');
  };

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h1 className="h4 mb-0">{title}</h1>
        <div className="d-flex gap-2">
          <input className="form-control" placeholder={`Search ${title.toLowerCase()}`} aria-label={`Search ${title}`}
            value={search} onChange={(e) => setSearch(e.target.value)} />
          {canEdit && <button className="btn btn-primary text-nowrap" onClick={() => openForm(null)}><i className="bi bi-plus-lg me-1"></i>Add</button>}
        </div>
      </div>

      <div className="card">
        <DataState state={list} isEmpty={list.data && rows.length === 0} emptyText={`No ${title.toLowerCase()} found.`}>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}{canEdit && <th className="text-end">Actions</th>}</tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {columns.map((c) => <td key={c.key}>{row[c.key] || '-'}</td>)}
                    {canEdit && (
                      <td className="text-end text-nowrap">
                        <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openForm(row)} aria-label="Edit"><i className="bi bi-pencil"></i></button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => setDeleting(row)} aria-label="Delete"><i className="bi bi-trash"></i></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>

      {editing && (
        <Modal title={`${editing.id ? 'Edit' : 'Add'} ${title.slice(0, -1).toLowerCase()}`} onClose={() => setEditing(null)}>
          <form onSubmit={save}>
            <div className="row g-3">
              {fields.map((f) => (
                <div key={f.name} className={f.wide ? 'col-12' : 'col-md-6'}>
                  <label htmlFor={`f-${f.name}`} className="form-label">{f.label}{f.required && ' *'}</label>
                  {f.options ? (
                    <select id={`f-${f.name}`} className="form-select" value={form[f.name] ?? ''}
                      onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}>
                      {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input id={`f-${f.name}`} type={f.type || 'text'} className="form-control" required={f.required}
                      value={form[f.name] ?? ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
                  )}
                </div>
              ))}
            </div>
            <div className="d-flex justify-content-between align-items-center gap-2 mt-4">
              {exampleForm && !editing.id ? (
                <button type="button" className="btn btn-outline-info" onClick={fillExample}>
                  <i className="bi bi-magic me-1"></i>Use example
                </button>
              ) : <span></span>}
              <div className="d-flex gap-2">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
      {deleting && <ConfirmModal message={`Delete "${deleting.name}"? This cannot be undone.`} onConfirm={remove} onCancel={() => setDeleting(null)} />}
    </>
  );
}

const Categories = () => (
  <CrudPage title="Categories" endpoint="categories"
    columns={[{ key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }]}
    fields={[{ name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description', wide: true }]}
    emptyForm={{ name: '', description: '' }}
    exampleForm={{ name: 'Beverages', description: 'Drinks and other beverage products' }} />
);

const Suppliers = () => (
  <CrudPage title="Suppliers" endpoint="suppliers"
    columns={[{ key: 'name', label: 'Name' }, { key: 'company_name', label: 'Company' }, { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' }, { key: 'tax_number', label: 'GST / Tax no.' }, { key: 'status', label: 'Status' }]}
    fields={[
      { name: 'name', label: 'Supplier name', required: true }, { name: 'company_name', label: 'Company name' },
      { name: 'phone', label: 'Phone', required: true }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'address', label: 'Address', wide: true }, { name: 'tax_number', label: 'GST / Tax number' },
      { name: 'status', label: 'Status', options: ['ACTIVE', 'INACTIVE'] },
    ]}
    emptyForm={{ name: '', company_name: '', phone: '', email: '', address: '', tax_number: '', status: 'ACTIVE' }}
    exampleForm={{
      name: 'Fresh Farms Traders',
      company_name: 'Fresh Farms Pvt Ltd',
      phone: '9876500001',
      email: 'sales@example.com',
      address: 'Bengaluru, Karnataka',
      tax_number: '29ABCDE1234F1Z5',
      status: 'ACTIVE',
    }} />
);

// ---------- Products ----------
const BLANK_PRODUCT = {
  name: '', sku: '', barcode: '', category_id: '', supplier_id: '', brand: '', description: '',
  purchase_price: '', selling_price: '', tax_percentage: '0', current_stock: '0', min_stock_level: '5',
  reorder_quantity: '10', expiry_date: '', status: 'ACTIVE',
};

function Products() {
  const { user } = useAuth();
  const canEdit = MANAGERS.includes(user.role);
  const [sp] = useSearchParams();
  const [filters, setFilters] = useState({ search: sp.get('search') || '', category_id: '', supplier_id: '', alert: '', sort: 'name', dir: 'asc', page: 1 });
  useEffect(() => {
    setFilters((f) => ({ ...f, search: sp.get('search') || '', page: 1 }));
  }, [sp]);
  const dSearch = useDebounced(filters.search);
  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v, page: 1 }));
  const toggleSort = (col) =>
    setFilters((f) => ({ ...f, sort: col, dir: f.sort === col && f.dir === 'asc' ? 'desc' : 'asc', page: 1 }));

  const list = useApi('/products', { ...filters, search: dSearch, limit: 10 });
  const cats = useApi('/categories');
  const sups = useApi('/suppliers');

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK_PRODUCT);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [viewing, setViewing] = useState(null);

  const openForm = (row) => {
    setEditing(row || {});
    setFile(null);
    setForm(row ? Object.fromEntries(Object.keys(BLANK_PRODUCT).map((k) => [k, row[k] ?? ''])) : { ...BLANK_PRODUCT });
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const fillExample = () => {
    const firstCategory = (cats.data || [])[0];
    const firstSupplier = (sups.data || [])[0];
    setForm({
      ...BLANK_PRODUCT,
      name: 'Basmati Rice 5kg',
      sku: `DEMO-${Date.now().toString().slice(-6)}`,
      barcode: `890100${Math.floor(1000 + Math.random() * 9000)}`,
      category_id: firstCategory ? String(firstCategory.id) : '',
      supplier_id: firstSupplier ? String(firstSupplier.id) : '',
      brand: 'Daawat',
      description: 'Example grocery product for testing manual entry.',
      purchase_price: '420',
      selling_price: '495',
      tax_percentage: '5',
      current_stock: '40',
      min_stock_level: '10',
      reorder_quantity: '30',
      expiry_date: '2027-08-01',
      status: 'ACTIVE',
    });
    toast.info('Example product filled in. You can edit any field before saving.');
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append('image', file);
      if (editing.id) await api.put(`/products/${editing.id}`, fd);
      else await api.post('/products', fd);
      toast.success(editing.id ? 'Product updated successfully.' : 'Product added successfully.');
      setEditing(null);
      list.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      const res = await api.delete(`/products/${deleting.id}`);
      toast.success(res.data.message);
      list.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(null);
    }
  };

  const sortHeader = (col, label) => (
    <th role="button" onClick={() => toggleSort(col)} className="text-nowrap">
      {label} {filters.sort === col ? (filters.dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  );
  const rows = list.data ? list.data.data : [];

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h1 className="h4 mb-0">Products</h1>
        {canEdit && <button className="btn btn-primary" onClick={() => openForm(null)}><i className="bi bi-plus-lg me-1"></i>Add product</button>}
      </div>

      <div className="card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-4">
            <input className="form-control" placeholder="Search name, SKU or barcode" aria-label="Search products"
              value={filters.search} onChange={(e) => setF('search', e.target.value)} />
          </div>
          <div className="col-6 col-md-3">
            <select className="form-select" aria-label="Filter by category" value={filters.category_id} onChange={(e) => setF('category_id', e.target.value)}>
              <option value="">All categories</option>
              {(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-3">
            <select className="form-select" aria-label="Filter by supplier" value={filters.supplier_id} onChange={(e) => setF('supplier_id', e.target.value)}>
              <option value="">All suppliers</option>
              {(sups.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="col-md-2">
            <select className="form-select" aria-label="Filter by stock status" value={filters.alert} onChange={(e) => setF('alert', e.target.value)}>
              <option value="">All stock</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
              <option value="expiring">Expiring / expired</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <DataState state={list} isEmpty={list.data && rows.length === 0} emptyText="No products match your filters.">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th>Image</th>{sortHeader('name', 'Product')}<th>Category</th>{sortHeader('price', 'Price')}
                  {sortHeader('stock', 'Stock')}{sortHeader('expiry', 'Expiry')}<th>Status</th><th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={p.status === 'INACTIVE' ? 'text-secondary' : ''}>
                    <td>
                      {p.image_path
                        ? <img src={`${API_ORIGIN}${p.image_path}`} alt={p.name} width="40" height="40" style={{ objectFit: 'cover' }} className="rounded" />
                        : <i className="bi bi-image fs-4 text-secondary" aria-hidden="true"></i>}
                    </td>
                    <td>
                      <div className="fw-semibold">{p.name} {p.status === 'INACTIVE' && <span className="badge bg-secondary">Inactive</span>}</div>
                      <div className="small text-secondary">{p.sku}{p.barcode ? ` · ${p.barcode}` : ''}</div>
                    </td>
                    <td>{p.category_name}</td>
                    <td>{money(p.selling_price)}</td>
                    <td>{p.current_stock}</td>
                    <td>{fmtDate(p.expiry_date)}</td>
                    <td><StockBadges p={p} /></td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setViewing(p)} aria-label="View details"><i className="bi bi-eye"></i></button>
                      {canEdit && (
                        <>
                          <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openForm(p)} aria-label="Edit"><i className="bi bi-pencil"></i></button>
                          <button className="btn btn-sm btn-outline-danger" onClick={() => setDeleting(p)} aria-label="Delete"><i className="bi bi-trash"></i></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.data && <Pagination page={list.data.page} pages={list.data.pages} onChange={(pg) => setFilters((f) => ({ ...f, page: pg }))} />}
        </DataState>
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit product' : 'Add product'} onClose={() => setEditing(null)}>
          <form onSubmit={save}>
            <div className="row g-3">
              <div className="col-md-6"><label htmlFor="p-name" className="form-label">Product name *</label>
                <input id="p-name" className="form-control" required value={form.name} onChange={set('name')} /></div>
              <div className="col-md-3"><label htmlFor="p-sku" className="form-label">SKU *</label>
                <input id="p-sku" className="form-control" required value={form.sku} onChange={set('sku')} /></div>
              <div className="col-md-3"><label htmlFor="p-barcode" className="form-label">Barcode</label>
                <input id="p-barcode" className="form-control" value={form.barcode} onChange={set('barcode')} /></div>
              <div className="col-md-4"><label htmlFor="p-cat" className="form-label">Category *</label>
                <select id="p-cat" className="form-select" required value={form.category_id} onChange={set('category_id')}>
                  <option value="">Select...</option>
                  {(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div className="col-md-4"><label htmlFor="p-sup" className="form-label">Supplier</label>
                <select id="p-sup" className="form-select" value={form.supplier_id} onChange={set('supplier_id')}>
                  <option value="">None</option>
                  {(sups.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
              <div className="col-md-4"><label htmlFor="p-brand" className="form-label">Brand</label>
                <input id="p-brand" className="form-control" value={form.brand} onChange={set('brand')} /></div>
              <div className="col-md-3"><label htmlFor="p-buy" className="form-label">Purchase price *</label>
                <input id="p-buy" type="number" min="0" step="0.01" className="form-control" required value={form.purchase_price} onChange={set('purchase_price')} /></div>
              <div className="col-md-3"><label htmlFor="p-sell" className="form-label">Selling price *</label>
                <input id="p-sell" type="number" min="0" step="0.01" className="form-control" required value={form.selling_price} onChange={set('selling_price')} /></div>
              <div className="col-md-3"><label htmlFor="p-tax" className="form-label">Tax %</label>
                <input id="p-tax" type="number" min="0" max="100" step="0.01" className="form-control" value={form.tax_percentage} onChange={set('tax_percentage')} /></div>
              <div className="col-md-3"><label htmlFor="p-stock" className="form-label">Opening stock</label>
                <input id="p-stock" type="number" min="0" className="form-control" disabled={!!editing.id} value={form.current_stock} onChange={set('current_stock')} />
                {editing.id && <div className="form-text">Change stock from the Inventory page.</div>}</div>
              <div className="col-md-3"><label htmlFor="p-min" className="form-label">Minimum stock</label>
                <input id="p-min" type="number" min="0" className="form-control" value={form.min_stock_level} onChange={set('min_stock_level')} /></div>
              <div className="col-md-3"><label htmlFor="p-reorder" className="form-label">Reorder quantity</label>
                <input id="p-reorder" type="number" min="0" className="form-control" value={form.reorder_quantity} onChange={set('reorder_quantity')} /></div>
              <div className="col-md-3"><label htmlFor="p-exp" className="form-label">Expiry date</label>
                <input id="p-exp" type="date" className="form-control" value={form.expiry_date} onChange={set('expiry_date')} /></div>
              <div className="col-md-3"><label htmlFor="p-status" className="form-label">Status</label>
                <select id="p-status" className="form-select" value={form.status} onChange={set('status')}>
                  <option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option>
                </select></div>
              <div className="col-12"><label htmlFor="p-desc" className="form-label">Description</label>
                <textarea id="p-desc" rows="2" className="form-control" value={form.description} onChange={set('description')} /></div>
              <div className="col-12"><label htmlFor="p-img" className="form-label">Product image (JPG, PNG or WEBP, max 2 MB)</label>
                <input id="p-img" type="file" accept="image/jpeg,image/png,image/webp" className="form-control" onChange={(e) => setFile(e.target.files[0] || null)} /></div>
            </div>
            <div className="d-flex justify-content-between align-items-center gap-2 mt-4">
              {!editing.id ? (
                <button type="button" className="btn btn-outline-info" onClick={fillExample}>
                  <i className="bi bi-magic me-1"></i>Fill example
                </button>
              ) : <span></span>}
              <div className="d-flex gap-2">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save product'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {viewing && (
        <Modal title={viewing.name} onClose={() => setViewing(null)}>
          <div className="row">
            {viewing.image_path && <div className="col-md-4 mb-3"><img src={`${API_ORIGIN}${viewing.image_path}`} alt={viewing.name} className="img-fluid rounded" /></div>}
            <div className="col">
              <dl className="row mb-0">
                {[['SKU', viewing.sku], ['Barcode', viewing.barcode || '-'], ['Category', viewing.category_name], ['Supplier', viewing.supplier_name || '-'],
                  ['Brand', viewing.brand || '-'], ['Purchase price', money(viewing.purchase_price)], ['Selling price', money(viewing.selling_price)],
                  ['Tax', `${viewing.tax_percentage}%`], ['Current stock', viewing.current_stock], ['Minimum stock', viewing.min_stock_level],
                  ['Reorder quantity', viewing.reorder_quantity], ['Expiry', fmtDate(viewing.expiry_date)], ['Created', fmtDate(viewing.created_at)],
                  ['Description', viewing.description || '-']].map(([k, v]) => (
                  <React.Fragment key={k}><dt className="col-5 col-md-4">{k}</dt><dd className="col-7 col-md-8">{v}</dd></React.Fragment>
                ))}
              </dl>
            </div>
          </div>
        </Modal>
      )}
      {deleting && <ConfirmModal message={`Delete "${deleting.name}"? Products with stock history will be set to Inactive instead.`} onConfirm={remove} onCancel={() => setDeleting(null)} />}
    </>
  );
}

// ---------- Inventory ----------
const TX_COLORS = { PURCHASE: 'success', SALE: 'primary', RETURN: 'info', DAMAGE: 'danger', MANUAL_ADJUSTMENT: 'orange' };

function AdjustModal({ onClose, onDone }) {
  const prods = useApi('/products', { limit: 200, sort: 'name' });
  const [form, setForm] = useState({ product_id: '', type: 'MANUAL_ADJUSTMENT', direction: 'add', quantity: '', note: '' });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const fillExample = () => {
    const firstProduct = prods.data?.data?.[0];
    if (!firstProduct) {
      toast.info('Add at least one product first.');
      return;
    }
    setForm({
      product_id: String(firstProduct.id),
      type: 'MANUAL_ADJUSTMENT',
      direction: 'add',
      quantity: '10',
      note: 'Example manual stock entry',
    });
    toast.info('Example stock adjustment filled in.');
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post('/inventory/adjustment', form);
      toast.success(res.data.message);
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Adjust stock" onClose={onClose} size="md">
      <form onSubmit={submit}>
        <div className="mb-3">
          <label htmlFor="a-prod" className="form-label">Product *</label>
          <select id="a-prod" className="form-select" required value={form.product_id} onChange={set('product_id')}>
            <option value="">Select...</option>
            {(prods.data ? prods.data.data : []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku}) - stock {p.current_stock}</option>)}
          </select>
        </div>
        <div className="row g-3 mb-3">
          <div className="col-md-6">
            <label htmlFor="a-type" className="form-label">Type</label>
            <select id="a-type" className="form-select" value={form.type} onChange={set('type')}>
              <option value="MANUAL_ADJUSTMENT">Manual adjustment</option>
              <option value="DAMAGE">Damaged product (removes stock)</option>
            </select>
          </div>
          {form.type === 'MANUAL_ADJUSTMENT' && (
            <div className="col-md-3">
              <label htmlFor="a-dir" className="form-label">Direction</label>
              <select id="a-dir" className="form-select" value={form.direction} onChange={set('direction')}>
                <option value="add">Add</option><option value="remove">Remove</option>
              </select>
            </div>
          )}
          <div className="col-md-3">
            <label htmlFor="a-qty" className="form-label">Quantity *</label>
            <input id="a-qty" type="number" min="1" className="form-control" required value={form.quantity} onChange={set('quantity')} />
          </div>
        </div>
        <div className="mb-3">
          <label htmlFor="a-note" className="form-label">Note</label>
          <input id="a-note" className="form-control" placeholder="Reason for this change" value={form.note} onChange={set('note')} />
        </div>
        <div className="d-flex justify-content-between align-items-center gap-2">
          <button type="button" className="btn btn-outline-info" onClick={fillExample}>
            <i className="bi bi-magic me-1"></i>Fill example
          </button>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save adjustment'}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function Inventory() {
  const { user } = useAuth();
  const canAdjust = ['ADMIN', 'MANAGER', 'STAFF'].includes(user.role);
  const summary = useApi('/inventory');
  const [tab, setTab] = useState('low');
  const [page, setPage] = useState(1);
  const [adjust, setAdjust] = useState(false);
  const isTx = tab === 'transactions';
  const list = useApi(
    isTx ? '/inventory/transactions' : '/products',
    isTx ? { page, limit: 15 } : { alert: tab === 'all' ? '' : tab, sort: tab === 'expiring' ? 'expiry' : 'stock', dir: 'asc', page, limit: 15 }
  );
  const s = summary.data;
  const rows = list.data ? list.data.data : [];
  const tabs = [['low', 'Low stock'], ['out', 'Out of stock'], ['expiring', 'Expiring / expired'], ['all', 'All stock'], ['transactions', 'Transactions']];

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h1 className="h4 mb-0">Inventory</h1>
        {canAdjust && <button className="btn btn-primary" onClick={() => setAdjust(true)}><i className="bi bi-sliders me-1"></i>Adjust stock</button>}
      </div>

      {s && (
        <div className="row g-3 mb-4">
          <StatCard label="Products" value={s.total_products} icon="box-seam" />
          <StatCard label="Units in stock" value={s.total_units} icon="stack" />
          <StatCard label="Valuation (cost)" value={money(s.stock_value)} icon="cash-stack" color="success" />
          <StatCard label="Retail value" value={money(s.retail_value)} icon="tag" color="success" />
          <StatCard label="Low stock" value={s.low_stock} icon="exclamation-triangle" color="warning" />
          <StatCard label="Out of stock" value={s.out_of_stock} icon="x-octagon" color="danger" />
          <StatCard label="Expiring (30 days)" value={s.expiring} icon="hourglass-split" color="warning" />
          <StatCard label="Expired" value={s.expired} icon="calendar-x" color="danger" />
        </div>
      )}

      <ul className="nav nav-tabs mb-3">
        {tabs.map(([key, label]) => (
          <li key={key} className="nav-item">
            <button className={`nav-link ${tab === key ? 'active' : ''}`} onClick={() => { setTab(key); setPage(1); }}>{label}</button>
          </li>
        ))}
      </ul>

      <div className="card">
        <DataState state={list} isEmpty={list.data && rows.length === 0} emptyText="Nothing to show here.">
          <div className="table-responsive">
            {isTx ? (
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light"><tr><th>Date</th><th>Product</th><th>Type</th><th>Change</th><th>Stock after</th><th>Note</th><th>By</th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td className="text-nowrap">{fmtDate(t.created_at)}</td>
                      <td>{t.product_name}<div className="small text-secondary">{t.sku}</div></td>
                      <td><span className={`badge bg-${TX_COLORS[t.type]}`}>{t.type.replace('_', ' ')}</span></td>
                      <td className={t.quantity_change > 0 ? 'text-success fw-semibold' : 'text-danger fw-semibold'}>{t.quantity_change > 0 ? '+' : ''}{t.quantity_change}</td>
                      <td>{t.stock_after}</td>
                      <td>{t.note || '-'}</td>
                      <td>{t.user_name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light"><tr><th>Product</th><th>Category</th><th>Stock</th><th>Minimum</th><th>Expiry</th><th>Value</th><th>Status</th></tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}<div className="small text-secondary">{p.sku}</div></td>
                      <td>{p.category_name}</td>
                      <td>{p.current_stock}</td>
                      <td>{p.min_stock_level}</td>
                      <td>{fmtDate(p.expiry_date)}</td>
                      <td>{money(p.current_stock * p.purchase_price)}</td>
                      <td><StockBadges p={p} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {list.data && <Pagination page={list.data.page} pages={list.data.pages} onChange={setPage} />}
        </DataState>
      </div>

      {adjust && <AdjustModal onClose={() => setAdjust(false)} onDone={() => { setAdjust(false); summary.reload(); list.reload(); }} />}
    </>
  );
}

// ---------- Notifications ----------
function Notifications() {
  const list = useApi('/notifications');
  const items = list.data ? list.data.items : [];

  const markRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      list.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };
  const markAll = async () => {
    try {
      const res = await api.put('/notifications/read-all');
      toast.success(res.data.message);
      list.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">Notifications</h1>
        <button className="btn btn-outline-secondary" onClick={markAll}>Mark all as read</button>
      </div>
      <div className="card">
        <DataState state={list} isEmpty={list.data && items.length === 0} emptyText="You're all caught up.">
          <ul className="list-group list-group-flush">
            {items.map((n) => (
              <li key={n.id} className={`list-group-item d-flex align-items-center gap-2 ${n.is_read ? 'text-secondary' : 'fw-semibold'}`}>
                <span className={`badge bg-${SEVERITY[n.severity][0]}`}>{SEVERITY[n.severity][1]}</span>
                <span className="flex-grow-1">{n.message}</span>
                <span className="small text-nowrap">{fmtDate(n.created_at)}</span>
                {!n.is_read && <button className="btn btn-sm btn-outline-primary" onClick={() => markRead(n.id)}>Mark read</button>}
              </li>
            ))}
          </ul>
        </DataState>
      </div>
    </>
  );
}

function NotFound() {
  return (
    <div className="container d-flex flex-column align-items-center justify-content-center min-vh-100 text-center">
      <h1 className="display-3 fw-bold text-primary">404</h1>
      <p className="text-secondary">The page you are looking for does not exist.</p>
      <Link to="/dashboard" className="btn btn-primary">Go to dashboard</Link>
    </div>
  );
}

// Shows the error on screen instead of a blank page
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="container py-5">
          <div className="alert alert-danger">
            <h1 className="h5">Something went wrong on this page</h1>
            <pre className="mb-0" style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error.stack || this.state.error)}</pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------- App + entry point ----------
function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/products" element={<Products />} />
        <Route path="/categories" element={<ProtectedRoute roles={MANAGERS}><Categories /></ProtectedRoute>} />
        <Route path="/suppliers" element={<ProtectedRoute roles={MANAGERS}><Suppliers /></ProtectedRoute>} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/notifications" element={<Notifications />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <ToastContainer position="top-right" autoClose={3500} />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);