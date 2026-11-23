import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Bar, Pie } from 'react-chartjs-2';
import { ArcElement, BarController, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, PieController, Tooltip } from 'chart.js';
import { ToastContainer, toast } from 'react-toastify';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import 'react-toastify/dist/ReactToastify.css';

// ---------- API helper ----------
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api'),
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isAuthCall = /\/auth\/(login|signup)$/.test(err.config?.url || '');
    if (err.response?.status === 401 && !isAuthCall) {
      localStorage.removeItem('token');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

const getErrorMessage = (err) => {
  const isAccountRoute = /^\/auth\/(login|signup|forgot-password|reset-password|change-password)$/.test(err.config?.url || '');
  if (err.response?.status === 404 && isAccountRoute) {
    return 'The account service is missing on the server. Please ask the administrator to deploy the latest SmartBiz API.';
  }
  return err.response?.data?.message || 'Unable to reach the server. Please try again.';
};

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

  const signup = async (registration) => {
    const res = await api.post('/auth/signup', registration);
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
    return res.data.user;
  };

  const acceptInvitation = async (token, name, password) => {
    const res = await api.post('/auth/accept-invitation', { token, name, password });
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

  return <AuthContext.Provider value={{ user, loading, login, signup, acceptInvitation, logout }}>{children}</AuthContext.Provider>;
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

// ---------- Login ----------
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
          <p className="text-secondary small">Inventory, sales &amp; business insights</p>
        </div>
        {location.state?.passwordReset && (
          <div className="alert alert-success py-2" role="status">
            Your password has been updated. Sign in with your new password.
          </div>
        )}
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
            <div className="text-end mt-1">
              <Link to="/forgot-password" state={{ email: form.email }} className="small">Forgot password?</Link>
            </div>
          </div>
          <button className="btn btn-primary w-100" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-secondary small mt-3 mb-0">
          New to SmartBiz? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </div>
  );
}

function ForgotPassword() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState('request');
  const [email, setEmail] = useState(location.state?.email || '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const requestCode = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setMessage(data.message);
      setStep('verify');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async (event) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { email, code, password });
      navigate('/login', { replace: true, state: { passwordReset: true } });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container d-flex align-items-center justify-content-center min-vh-100 py-4">
      <div className="card p-4 shadow-sm" style={{ maxWidth: 460, width: '100%' }}>
        <div className="text-center mb-4">
          <i className="bi bi-box-seam fs-1 text-primary" aria-hidden="true"></i>
          <h1 className="h4 mt-2 mb-0">Reset your password</h1>
          <p className="text-secondary small mb-0">Verify your email to choose a new password</p>
        </div>
        {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
        {message && <div className="alert alert-info py-2" role="status">{message}</div>}

        {step === 'request' ? (
          <form onSubmit={requestCode}>
            <div className="mb-3">
              <label htmlFor="reset-email" className="form-label">Account email</label>
              <input id="reset-email" type="email" className="form-control" required maxLength={150}
                autoComplete="email" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <button className="btn btn-primary w-100" disabled={submitting}>
              {submitting ? 'Sending code...' : 'Email me a reset code'}
            </button>
          </form>
        ) : (
          <form onSubmit={resetPassword}>
            <div className="mb-3">
              <label htmlFor="reset-code" className="form-label">Six-digit email code</label>
              <input id="reset-code" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                className="form-control" required autoComplete="one-time-code" autoFocus value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
              <div className="form-text">The code expires in 10 minutes. Check your spam folder if needed.</div>
            </div>
            <div className="mb-3">
              <label htmlFor="reset-new-password" className="form-label">New password</label>
              <input id="reset-new-password" type="password" className="form-control" required minLength={8}
                autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <div className="form-text">Use at least 8 characters with uppercase, lowercase, a number, and a symbol.</div>
            </div>
            <div className="mb-3">
              <label htmlFor="reset-confirm-password" className="form-label">Confirm new password</label>
              <input id="reset-confirm-password" type="password" className="form-control" required
                autoComplete="new-password" value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
            <button className="btn btn-primary w-100" disabled={submitting}>
              {submitting ? 'Updating password...' : 'Reset password'}
            </button>
            <button type="button" className="btn btn-link w-100 mt-2" disabled={submitting}
              onClick={() => { setStep('request'); setCode(''); setMessage(''); setError(''); }}>
              Use a different email or request a new code
            </button>
          </form>
        )}

        <p className="text-center text-secondary small mt-3 mb-0">
          Remembered it? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

function Register() {
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '', confirmPassword: '',
    shopName: '', shopType: 'Kirana', address: '', country: 'India',
    state: '', city: '', area: '', pincode: '', latitude: '', longitude: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [locationError, setLocationError] = useState('');
  const [registrationResult, setRegistrationResult] = useState(null);

  if (user && !registrationResult) return <Navigate to="/dashboard" replace />;

  const handleChange = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  const detectLocation = () => {
    setLocationError('');
    setLocationMessage('');
    if (!navigator.geolocation) {
      setLocationError('This browser does not support location detection. Enter the shop address manually.');
      return;
    }

    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const { latitude, longitude } = coords;
      setForm((current) => ({ ...current, latitude: String(latitude), longitude: String(longitude) }));
      setLocationMessage('Location detected. Confirm that this is your shop location and correct any address details.');
      try {
        const url = new URL('https://nominatim.openstreetmap.org/reverse');
        url.search = new URLSearchParams({
          format: 'jsonv2',
          addressdetails: '1',
          lat: String(latitude),
          lon: String(longitude),
          zoom: '18',
        });
        const response = await fetch(url);
        if (!response.ok) throw new Error('Address lookup failed.');
        const result = await response.json();
        const place = result.address || {};
        setForm((current) => ({
          ...current,
          address: result.display_name || current.address,
          country: place.country || current.country,
          state: place.state || place.region || current.state,
          city: place.city || place.town || place.village || place.municipality || current.city,
          area: place.suburb || place.neighbourhood || place.quarter || place.hamlet || current.area,
          pincode: place.postcode || current.pincode,
        }));
      } catch {
        setLocationError('Coordinates were detected, but the address lookup failed. Enter or correct the shop address manually.');
      } finally {
        setDetectingLocation(false);
      }
    }, (error) => {
      const message = error.code === error.PERMISSION_DENIED
        ? 'Location permission was denied. You can still enter the shop address manually.'
        : error.code === error.POSITION_UNAVAILABLE
          ? 'Your current location is unavailable. Enter the shop address manually.'
          : 'Location detection timed out. Enter the shop address manually.';
      setLocationError(message);
      setDetectingLocation(false);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const { confirmPassword, ...registration } = form;
      const newUser = await signup(registration);
      setRegistrationResult(newUser);
      toast.success(`Welcome to SmartBiz, ${newUser.name}!`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (registrationResult) {
    return (
      <div className="container d-flex align-items-center justify-content-center min-vh-100 py-4">
        <div className="card p-4 p-md-5 shadow-sm text-center" style={{ maxWidth: 560, width: '100%' }}>
          <div className="text-success display-4 mb-3"><i className="bi bi-check-circle-fill" aria-hidden="true"></i></div>
          <h1 className="h3">Your shop is registered</h1>
          <p className="text-secondary">You are the Admin/Owner of {registrationResult.shop_name}.</p>
          <div className="rounded border bg-light p-3 mb-4">
            <div className="small text-uppercase text-secondary fw-semibold">Your SmartBiz Shop Code</div>
            <div className="fs-3 fw-bold text-primary">{registrationResult.shop_code}</div>
            <div className="small text-secondary">Keep this code for your shop records.</div>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/dashboard', { replace: true })}>
            Continue to your shop
          </button>
        </div>
      </div>
    );
  }

  const mapUrl = form.latitude && form.longitude
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${Number(form.longitude) - 0.01}%2C${Number(form.latitude) - 0.01}%2C${Number(form.longitude) + 0.01}%2C${Number(form.latitude) + 0.01}&layer=mapnik&marker=${form.latitude}%2C${form.longitude}`
    : '';

  return (
    <div className="container d-flex align-items-center justify-content-center min-vh-100 py-4">
      <div className="card p-4 p-md-5 shadow-sm" style={{ maxWidth: 820, width: '100%' }}>
        <div className="text-center mb-4">
          <i className="bi bi-box-seam fs-1 text-primary" aria-hidden="true"></i>
          <h1 className="h4 mt-2 mb-0">Register your shop</h1>
          <p className="text-secondary small mb-0">Create an owner account and a separate SmartBiz workspace</p>
        </div>
        <form onSubmit={handleSubmit} className="row g-3">
          <div className="col-12"><h2 className="h6 mb-0">Owner details</h2></div>
          <div className="col-md-6">
            <label htmlFor="register-name" className="form-label">Full name</label>
            <input id="register-name" name="name" type="text" className="form-control" required maxLength={100}
              autoComplete="name" autoFocus value={form.name} onChange={handleChange} />
          </div>
          <div className="col-md-6">
            <label htmlFor="register-email" className="form-label">Email address</label>
            <input id="register-email" name="email" type="email" className="form-control" required maxLength={150}
              autoComplete="email" value={form.email} onChange={handleChange} />
          </div>
          <div className="col-md-6">
            <label htmlFor="register-phone" className="form-label">Phone number</label>
            <input id="register-phone" name="phone" type="tel" className="form-control" required maxLength={20}
              autoComplete="tel" value={form.phone} onChange={handleChange} />
          </div>
          <div className="col-md-6">
            <label htmlFor="register-password" className="form-label">Password</label>
            <input id="register-password" name="password" type="password" className="form-control" required minLength={8}
              autoComplete="new-password" value={form.password} onChange={handleChange} />
            <div className="form-text">Use uppercase, lowercase, a number, and a symbol.</div>
          </div>
          <div className="col-md-6">
            <label htmlFor="register-confirm-password" className="form-label">Confirm password</label>
            <input id="register-confirm-password" name="confirmPassword" type="password" className="form-control" required
              autoComplete="new-password" value={form.confirmPassword} onChange={handleChange} />
          </div>

          <div className="col-12 mt-4"><h2 className="h6 mb-0">Shop details</h2></div>
          <div className="col-md-6">
            <label htmlFor="register-shop-name" className="form-label">Shop name</label>
            <input id="register-shop-name" name="shopName" className="form-control" required maxLength={150}
              value={form.shopName} onChange={handleChange} />
          </div>
          <div className="col-md-6">
            <label htmlFor="register-shop-type" className="form-label">Shop type</label>
            <select id="register-shop-type" name="shopType" className="form-select" value={form.shopType} onChange={handleChange}>
              {['Grocery', 'Kirana', 'Supermarket', 'Medical', 'Clothing', 'Electronics', 'Other']
                .map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>

          <div className="col-12 mt-4 d-flex flex-wrap justify-content-between align-items-center gap-2">
            <h2 className="h6 mb-0">Shop location</h2>
            <button type="button" className="btn btn-outline-primary btn-sm" onClick={detectLocation} disabled={detectingLocation}>
              <i className="bi bi-geo-alt me-1" aria-hidden="true"></i>
              {detectingLocation ? 'Detecting location...' : 'Detect My Current Location'}
            </button>
          </div>
          <div className="col-12">
            <label htmlFor="register-address" className="form-label">Shop address</label>
            <textarea id="register-address" name="address" className="form-control" required maxLength={255} rows={2}
              value={form.address} onChange={handleChange} />
          </div>
          {[
            ['country', 'Country'], ['state', 'State'], ['city', 'City'], ['area', 'Area / Locality'], ['pincode', 'PIN Code'],
          ].map(([name, label]) => (
            <div className="col-sm-6 col-md-4" key={name}>
              <label htmlFor={`register-${name}`} className="form-label">{label}</label>
              <input id={`register-${name}`} name={name} className="form-control" required maxLength={name === 'pincode' ? 20 : 100}
                autoComplete={name === 'pincode' ? 'postal-code' : 'address-level2'}
                value={form[name]} onChange={handleChange} />
            </div>
          ))}
          {locationMessage && <div className="col-12"><div className="alert alert-success py-2 mb-0" role="status">{locationMessage}</div></div>}
          {locationError && <div className="col-12"><div className="alert alert-warning py-2 mb-0" role="alert">{locationError}</div></div>}
          {mapUrl && (
            <div className="col-12">
              <div className="small text-secondary mb-2">Map preview. Verify this marker is at your shop, not just your current device location.</div>
              <iframe title="Detected shop location map" src={mapUrl} className="w-100 border rounded"
                height="220" loading="lazy" referrerPolicy="no-referrer" />
            </div>
          )}
          <div className="col-12">
            <div className="alert alert-light border small mb-0">
              Your shop gets a unique ID and code. The registering owner becomes its Admin; employees join through invitations.
            </div>
          </div>
          <div className="col-12">
            <button className="btn btn-primary w-100" disabled={submitting || detectingLocation}>
              {submitting ? 'Registering shop...' : 'Register shop'}
            </button>
          </div>
        </form>
        <p className="text-center text-secondary small mt-3 mb-0">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

function AcceptInvitation() {
  const { acceptInvitation } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [invitation, setInvitation] = useState(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invitation link is missing its token.');
      setLoading(false);
      return;
    }
    api.get(`/auth/invitations/${encodeURIComponent(token)}`)
      .then(({ data }) => setInvitation(data))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await acceptInvitation(token, name, password);
      window.location.assign('/dashboard');
    } catch (err) {
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="container d-flex align-items-center justify-content-center min-vh-100 py-4">
      <div className="card p-4 shadow-sm" style={{ maxWidth: 480, width: '100%' }}>
        <h1 className="h4">Join a SmartBiz shop</h1>
        {loading ? <p className="text-secondary">Checking invitation...</p> : null}
        {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
        {invitation && (
          <>
            <p className="text-secondary">
              You are invited to <strong>{invitation.shop_name}</strong> as <strong>{invitation.role}</strong>.
            </p>
            <div className="mb-3"><span className="small text-secondary">Invited email</span><div>{invitation.email}</div></div>
            <form onSubmit={submit}>
              <div className="mb-3">
                <label htmlFor="invite-name" className="form-label">Full name</label>
                <input id="invite-name" className="form-control" required maxLength={100} value={name}
                  onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="mb-3">
                <label htmlFor="invite-password" className="form-label">Create password</label>
                <input id="invite-password" type="password" className="form-control" required minLength={8}
                  autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                <div className="form-text">Use uppercase, lowercase, a number, and a symbol.</div>
              </div>
              <div className="mb-3">
                <label htmlFor="invite-confirm-password" className="form-label">Confirm password</label>
                <input id="invite-confirm-password" type="password" className="form-control" required
                  autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </div>
              <button className="btn btn-primary w-100" disabled={submitting}>
                {submitting ? 'Joining shop...' : 'Accept invitation'}
              </button>
            </form>
          </>
        )}
        {!loading && !invitation && <Link to="/login" className="btn btn-outline-primary">Back to sign in</Link>}
      </div>
    </div>
  );
}

// ---------- Shared UI helpers ----------
const API_ORIGIN = (api.defaults.baseURL || '').replace(/\/api\/?$/, '');
const MANAGERS = ['ADMIN', 'MANAGER'];
const ADMINS = ['ADMIN'];
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
  { to: '/team', label: 'Team', icon: 'people', roles: ADMINS },
  { to: '/inventory', label: 'Inventory', icon: 'clipboard-data' },
  { to: '/notifications', label: 'Notifications', icon: 'bell' },
];

const AI_SUGGESTIONS = [
  'Which products are low in stock?',
  "Show this month's sales.",
  'Which products are selling the most?',
  'Which products are expiring soon?',
  'Compare this month with last month.',
];

function SmartBizAssistant({ compact = false, onClose }) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorRetryable, setErrorRetryable] = useState(true);
  const [retryPrompt, setRetryPrompt] = useState('');
  const conversationRef = useRef(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages, isLoading, error]);

  const startNewConversation = () => {
    requestId.current += 1;
    setMessages([]);
    setInput('');
    setIsLoading(false);
    setError('');
    setErrorRetryable(true);
    setRetryPrompt('');
  };

  const sendMessage = async (event, messageText = input, isRetry = false) => {
    event?.preventDefault();
    const message = messageText.trim();
    if (!message || isLoading) return;

    const activeRequest = requestId.current + 1;
    requestId.current = activeRequest;
    const nextMessages = isRetry
      ? messages
      : [...messages, { id: activeRequest, role: 'user', text: message }];
    const contextMessages = nextMessages.slice(-12).map(({ role, text }) => ({ role, content: text }));
    while (contextMessages.length > 1
      && contextMessages.reduce((length, item) => length + item.content.length, 0) > 12000) {
      contextMessages.shift();
    }
    if (!isRetry) {
      setMessages(nextMessages);
      setInput('');
    }
    setError('');
    setErrorRetryable(true);
    setRetryPrompt(message);
    setIsLoading(true);

    try {
      const { data } = await api.post('/ai/chat', {
        messages: contextMessages,
      });
      if (requestId.current !== activeRequest) return;
      if (typeof data.message !== 'string' || !data.message.trim()) {
        throw new Error('SmartBiz Assistant returned an empty response. Please retry.');
      }
      setMessages((current) => [...current, {
        id: `${activeRequest}-assistant`,
        role: 'assistant',
        text: data.message.trim(),
      }]);
      setRetryPrompt('');
    } catch (err) {
      if (requestId.current === activeRequest) {
        const status = err.response?.status;
        const serverMessage = err.response?.data?.message || '';
        const staleAiServer = /openai|api[_ -]?key/i.test(serverMessage);
        setError(staleAiServer
          ? 'This SmartBiz backend is still running an older AI integration. Restart the backend; no AI API key is required.'
          : serverMessage || err.message || 'Unable to reach SmartBiz Assistant. Please retry.');
        setErrorRetryable(!staleAiServer
          && (status === undefined || status === 408 || status === 429 || status >= 500));
      }
    } finally {
      if (requestId.current === activeRequest) setIsLoading(false);
    }
  };

  return (
    <>
      <section className={`sb-ai-panel ${compact ? 'sb-ai-panel-compact' : ''}`} aria-label="SmartBiz AI Assistant">
        <header className="sb-ai-header">
          <div className="d-flex align-items-center gap-2">
            <span className="sb-ai-header-icon" aria-hidden="true"><i className="bi bi-stars"></i></span>
            <div>
              <h2 className="sb-ai-title">SmartBiz AI Assistant</h2>
              <span className="sb-ai-subtitle">Here to help with your business</span>
            </div>
          </div>
          <button type="button" className="sb-ai-icon-button" aria-label="New conversation" title="New conversation"
            onClick={startNewConversation}>
            <i className="bi bi-plus-lg" aria-hidden="true"></i>
          </button>
          {compact && (
            <button type="button" className="sb-ai-icon-button" aria-label="Close assistant" title="Close assistant"
              onClick={onClose}>
              <i className="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          )}
        </header>

        <div className="sb-ai-conversation" ref={conversationRef} aria-live="polite">
          {messages.length === 0 ? (
            <div className="sb-ai-welcome">
              <div className="sb-ai-welcome-mark" aria-hidden="true"><i className="bi bi-stars"></i></div>
              <div className="sb-ai-bubble sb-ai-assistant-bubble">
                Hi! I'm your SmartBiz AI Assistant. How can I help you manage your business today?
              </div>
              <p className="sb-ai-suggestion-label">Try asking</p>
              <div className="sb-ai-suggestions">
                {AI_SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" className="sb-ai-suggestion"
                    onClick={(event) => sendMessage(event, suggestion)}>
                    {suggestion}<i className="bi bi-arrow-up-left" aria-hidden="true"></i>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="sb-ai-message-list">
              {messages.map((message) => (
                <div className={`sb-ai-message-row ${message.role === 'user' ? 'sb-ai-user-row' : ''}`} key={message.id}>
                  <div className={`sb-ai-bubble ${message.role === 'user' ? 'sb-ai-user-bubble' : 'sb-ai-assistant-bubble'}`}>
                    {message.text}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="sb-ai-message-row" role="status" aria-label="Waiting for assistant">
                  <div className="sb-ai-bubble sb-ai-assistant-bubble sb-ai-loading">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              )}
              {error && (
                <div className="sb-ai-error" role="alert">
                  <i className="bi bi-info-circle" aria-hidden="true"></i>
                  <span>{error}</span>
                  <button type="button" className="sb-ai-retry"
                    onClick={errorRetryable
                      ? () => sendMessage(null, retryPrompt, true)
                      : () => { setError(''); setRetryPrompt(''); }}
                    disabled={isLoading || !retryPrompt}>
                    {errorRetryable ? 'Retry' : 'Dismiss'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <form className="sb-ai-composer" onSubmit={sendMessage}>
          <label htmlFor="sb-ai-message" className="visually-hidden">Message SmartBiz AI Assistant</label>
          <textarea id="sb-ai-message" className="sb-ai-input" rows="1" placeholder="Ask a question..."
            value={input} maxLength={2000} onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage(event);
              }
            }} />
          <button type="submit" className="sb-ai-send" disabled={!input.trim() || isLoading} aria-label="Send message">
            <i className="bi bi-arrow-up" aria-hidden="true"></i>
          </button>
          <span className="sb-ai-composer-hint">Enter to send · Shift+Enter for a new line</span>
        </form>
      </section>

      <style>{`
        .sb-ai-panel{width:100%;height:min(72vh,760px);min-height:480px;display:flex;flex-direction:column;overflow:hidden;background:#fff;border:1px solid #e4eee7;border-radius:18px;box-shadow:0 8px 28px rgba(12,44,27,.08)}
        .sb-ai-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 14px 14px 16px;color:#fff;background:linear-gradient(120deg,#11623b,#208c55)}
        .sb-ai-header-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,.16);font-size:19px}
        .sb-ai-title{margin:0;font-size:15px;font-weight:650;line-height:1.3}
        .sb-ai-subtitle{font-size:11px;color:rgba(255,255,255,.8)}
        .sb-ai-icon-button{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:9px;color:#fff;background:transparent;transition:background .18s ease,transform .18s ease}
        .sb-ai-icon-button:hover,.sb-ai-icon-button:focus-visible{background:rgba(255,255,255,.18);transform:translateY(-1px)}
        .sb-ai-conversation{flex:1;min-height:0;overflow-y:auto;padding:20px 16px;background:#f7faf8;scrollbar-color:#c4d7ca transparent;scrollbar-width:thin}
        .sb-ai-welcome{display:flex;flex-direction:column;align-items:flex-start}
        .sb-ai-welcome-mark{display:grid;place-items:center;width:38px;height:38px;margin:0 0 10px;border-radius:13px;color:#16824b;background:#e3f3e9;font-size:19px}
        .sb-ai-bubble{max-width:88%;padding:11px 13px;border-radius:15px;font-size:13px;line-height:1.55;overflow-wrap:anywhere}
        .sb-ai-assistant-bubble{color:#26352b;background:#fff;border:1px solid #e8eee9;border-top-left-radius:5px;box-shadow:0 2px 7px rgba(20,48,29,.04)}
        .sb-ai-suggestion-label{margin:22px 0 9px;color:#728076;font-size:11px;font-weight:650;letter-spacing:.04em;text-transform:uppercase}
        .sb-ai-suggestions{display:flex;flex-direction:column;align-items:flex-start;gap:8px;width:100%}
        .sb-ai-suggestion{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:9px 11px;border:1px solid #dfeae2;border-radius:11px;color:#315440;background:#fff;text-align:left;font-size:12px;transition:border-color .18s ease,background .18s ease,transform .18s ease}
        .sb-ai-suggestion i{color:#16824b;opacity:0;transition:opacity .18s ease}
        .sb-ai-suggestion:hover,.sb-ai-suggestion:focus-visible{border-color:#6db687;background:#f0f8f2;transform:translateY(-1px)}
        .sb-ai-suggestion:hover i,.sb-ai-suggestion:focus-visible i{opacity:1}
        .sb-ai-message-list{display:flex;flex-direction:column;gap:13px}
        .sb-ai-message-row{display:flex;align-items:flex-end}
        .sb-ai-user-row{justify-content:flex-end}
        .sb-ai-user-bubble{color:#fff;background:#16824b;border-bottom-right-radius:5px}
        .sb-ai-error{display:flex;align-items:flex-start;gap:8px;margin-top:2px;padding:10px 11px;border:1px solid #f3d4a4;border-radius:11px;color:#735319;background:#fff8e9;font-size:12px;line-height:1.45}
        .sb-ai-error i{flex:none;margin-top:1px}
        .sb-ai-retry{flex:none;padding:2px 7px;border:1px solid #e6cf9f;border-radius:7px;color:#735319;background:#fff;font-size:11px}
        .sb-ai-retry:hover:not(:disabled){background:#fff0ce}
        .sb-ai-retry:disabled{cursor:not-allowed;opacity:.55}
        .sb-ai-loading{display:flex;gap:4px;align-items:center;height:37px}
        .sb-ai-loading span{width:6px;height:6px;border-radius:50%;background:#60a777;animation:sb-ai-dot 1s infinite ease-in-out}
        .sb-ai-loading span:nth-child(2){animation-delay:.15s}.sb-ai-loading span:nth-child(3){animation-delay:.3s}
        .sb-ai-composer{position:relative;display:flex;align-items:flex-end;gap:8px;padding:12px 13px 28px;border-top:1px solid #eaf0eb;background:#fff}
        .sb-ai-input{flex:1;min-width:0;max-height:100px;resize:none;padding:10px 12px;border:1px solid #dce7de;border-radius:12px;color:#24352a;background:#fbfdfb;font:inherit;font-size:13px;line-height:1.45;outline:none}
        .sb-ai-input:focus{border-color:#62a77a;box-shadow:0 0 0 3px rgba(39,137,78,.12)}
        .sb-ai-send{display:grid;place-items:center;flex:none;width:38px;height:38px;border:0;border-radius:12px;color:#fff;background:#16824b;font-size:19px;transition:background .18s ease,transform .18s ease}
        .sb-ai-send:not(:disabled):hover{background:#10663a;transform:translateY(-1px)}
        .sb-ai-send:disabled{cursor:not-allowed;opacity:.45}
        .sb-ai-composer-hint{position:absolute;bottom:9px;left:16px;color:#87948b;font-size:10px}
        .sb-ai-icon-button:focus-visible,.sb-ai-suggestion:focus-visible,.sb-ai-send:focus-visible{outline:3px solid #a5d8b5;outline-offset:2px}
        @keyframes sb-ai-dot{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}
        @media(max-width:767px){.sb-ai-panel{height:calc(100dvh - 240px);min-height:400px}}
        .sb-ai-panel-compact{height:540px;min-height:320px;max-height:calc(100dvh - 100px)}
        @media(max-width:767px){.sb-ai-panel-compact{height:calc(100dvh - 100px);min-height:320px}}
        @media(prefers-reduced-motion:reduce){.sb-ai-panel *{animation-duration:.01ms!important;transition-duration:.01ms!important}}
      `}</style>
    </>
  );
}

function ChangePasswordModal({ onClose }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const updateForm = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast.success(data.message);
      onClose();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="modal-backdrop fade show" style={{ zIndex: 1090 }} onClick={onClose}></div>
      <div className="modal d-block" role="dialog" aria-modal="true" aria-labelledby="change-password-title"
        style={{ zIndex: 1091 }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <form onSubmit={submit}>
              <div className="modal-header">
                <h2 className="modal-title fs-5" id="change-password-title">Change password</h2>
                <button type="button" className="btn-close" aria-label="Close" onClick={onClose}></button>
              </div>
              <div className="modal-body">
                {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
                <div className="mb-3">
                  <label htmlFor="current-password" className="form-label">Current password</label>
                  <input id="current-password" name="currentPassword" type="password" className="form-control"
                    autoComplete="current-password" required value={form.currentPassword} onChange={updateForm} />
                </div>
                <div className="mb-3">
                  <label htmlFor="new-password" className="form-label">New password</label>
                  <input id="new-password" name="newPassword" type="password" className="form-control"
                    autoComplete="new-password" required value={form.newPassword} onChange={updateForm} />
                  <div className="form-text">Use at least 8 characters with uppercase, lowercase, a number, and a symbol.</div>
                </div>
                <div>
                  <label htmlFor="confirm-new-password" className="form-label">Confirm new password</label>
                  <input id="confirm-new-password" name="confirmPassword" type="password" className="form-control"
                    autoComplete="new-password" required value={form.confirmPassword} onChange={updateForm} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Change password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState('');
  const [unread, setUnread] = useState(0);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

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
        .sb-ai-widget{position:fixed;left:auto;right:16px;bottom:16px;z-index:1080}
        .sb-ai-widget-panel{width:380px;max-width:calc(100vw - 88px);margin-bottom:12px}
        .sb-ai-widget-button{display:grid;place-items:center;width:58px;height:58px;border:0;border-radius:50%;color:#fff;background:#16824b;box-shadow:0 6px 20px rgba(0,0,0,.24);font-size:25px}
        .sb-ai-widget-button:hover,.sb-ai-widget-button:focus-visible{background:#11623b}
        @media(max-width:767px){.sb-ai-widget{left:auto;right:8px;bottom:8px}.sb-ai-widget-panel{width:calc(100vw - 88px);max-width:calc(100vw - 88px)}}
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
                <button className="btn btn-sm btn-outline-primary mb-2"
                  onClick={() => { setMenu(false); setChangePasswordOpen(true); }}>Change password</button>
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
      <div className="sb-ai-widget">
        {assistantOpen && (
          <div className="sb-ai-widget-panel" role="dialog" aria-label="SmartBiz AI Assistant">
            <SmartBizAssistant compact onClose={() => setAssistantOpen(false)} />
          </div>
        )}
        <button type="button" className="sb-ai-widget-button"
          aria-label={`${assistantOpen ? 'Close' : 'Open'} SmartBiz AI Assistant`}
          aria-expanded={assistantOpen} onClick={() => setAssistantOpen((currentOpen) => !currentOpen)}>
          <i className={`bi ${assistantOpen ? 'bi-x-lg' : 'bi-stars'}`} aria-hidden="true"></i>
        </button>
      </div>
      {changePasswordOpen && <ChangePasswordModal onClose={() => setChangePasswordOpen(false)} />}
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

function BasicDashboard() {
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
      <SalesProfitCharts
        months={[]}
        topSelling={[]}
        hasSales={false}
        emptyMessage="No sales data is available for this account yet."
      />
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

// ---------- Analytics dashboard (Admin / Manager) ----------
ChartJS.register(BarController, PieController, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

const CHART_COLORS = ['#1e3a8a', '#10b981', '#8b5e3c', '#f97316', '#94a3b8'];
const shortMoney = (n) => (n >= 100000 ? `${(n / 100000).toFixed(1)}L` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n));

function SalesProfitCharts({ months, topSelling, hasSales, emptyMessage = 'No sales recorded yet.' }) {
  const now = new Date();
  const labels = months.length
    ? months.map((month) => month.month)
    : Array.from({ length: 7 }, (_, index) => {
      const month = new Date(now.getFullYear(), now.getMonth() - (6 - index), 1);
      return month.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    });
  const performanceData = {
    labels,
    datasets: [
      { label: 'Sales', data: months.length ? months.map((month) => month.sales) : labels.map(() => 0), backgroundColor: '#4f7cf0', borderRadius: 4 },
      { label: 'Gross profit', data: months.length ? months.map((month) => month.gross_profit) : labels.map(() => 0), backgroundColor: '#10b981', borderRadius: 4 },
    ],
  };
  const productData = {
    labels: topSelling.map((product) => product.name),
    datasets: [{
      data: topSelling.map((product) => Number(product.sold_qty)),
      backgroundColor: CHART_COLORS,
      borderWidth: 2,
      borderColor: '#fff',
    }],
  };
  const salesOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', align: 'start', labels: { usePointStyle: true, boxWidth: 8 } },
      tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${money(context.parsed.y)}` } },
    },
    scales: {
      y: { beginAtZero: true, ticks: { callback: (value) => shortMoney(value) }, grid: { color: '#eef1f6' } },
      x: { grid: { display: false } },
    },
  };
  const productOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
  };

  return (
    <div className="row g-3 mb-4">
      <div className="col-lg-8">
        <div className="card border-0 shadow-sm h-100 p-3">
          <div className="fw-semibold mb-2">Sales &amp; Gross Profit <span className="text-secondary small fw-normal">(last 7 months)</span></div>
          <div className="position-relative" style={{ height: 260 }}>
            <Bar data={performanceData} options={salesOptions} />
            {!hasSales && (
              <span className="position-absolute top-50 start-50 translate-middle text-secondary small text-center bg-white bg-opacity-75 px-2">
                {emptyMessage}
              </span>
            )}
          </div>
          {months.some((month) => month.gross_profit === null) && (
            <p className="small text-secondary mb-0">Gross profit is unavailable for months containing sales without item details.</p>
          )}
        </div>
      </div>
      <div className="col-lg-4">
        <div className="card border-0 shadow-sm h-100 p-3">
          <div className="fw-semibold mb-2">Top-selling products</div>
          <div className="position-relative" style={{ height: 260 }}>
            <Pie data={productData} options={productOptions} />
            {!topSelling.length && (
              <span className="position-absolute top-50 start-50 translate-middle text-secondary small text-center bg-white bg-opacity-75 px-2">
                {emptyMessage}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, bg, to }) {
  return (
    <div className="col-12 col-md-4">
      <div className="card h-100 p-3 border-0 shadow-sm">
        <div className="d-flex justify-content-between align-items-start">
          <span className="d-inline-flex align-items-center justify-content-center rounded-3 text-white" style={{ width: 42, height: 42, background: bg }}>
            <i className={`bi bi-${icon} fs-5`} aria-hidden="true"></i>
          </span>
          <Link to={to} className="btn btn-primary rounded-circle d-inline-flex align-items-center justify-content-center p-0" style={{ width: 26, height: 26 }} aria-label={`Open ${label}`}>
            <i className="bi bi-chevron-right small" aria-hidden="true"></i>
          </Link>
        </div>
        <div className="text-secondary text-uppercase mt-3" style={{ fontSize: 12, letterSpacing: '.03em' }}>{label}</div>
        <div className="fs-4 fw-semibold">{Number(value || 0).toLocaleString('en-IN')}</div>
      </div>
    </div>
  );
}

function AnalyticsDashboard() {
  const { user } = useAuth();
  const dash = useApi('/dashboard');
  const d = dash.data;

  return (
    <>
      <div className="mb-3">
        <h1 className="h4 mb-0">Hello, {user.name}</h1>
        <div className="text-secondary small">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
      </div>

      <DataState state={dash}>
        {d && (
          <>
            <div className="row g-3 mb-3">
              <KpiCard label="Total products in inventory" value={d.total_products} icon="box-seam" bg="#198754" to="/products" />
              <KpiCard label="Total quantity on hand" value={d.total_units} icon="stack" bg="#fd7e14" to="/inventory" />
              <KpiCard label="Out of stock products" value={d.out_of_stock} icon="x-octagon" bg="#dc3545" to="/inventory" />
            </div>

            <SalesProfitCharts months={d.months} topSelling={d.topSelling} hasSales={d.hasSales} />

            <div className="row g-3">
              <div className="col-lg-6">
                <div className="card border-0 shadow-sm h-100">
                  <div className="d-flex justify-content-between align-items-center p-3 pb-2">
                    <span className="fw-semibold">Low Stock Alert</span>
                    <Link to="/inventory" className="small">View all</Link>
                  </div>
                  {d.lowStock.length === 0 ? (
                    <Empty text="All products are well stocked." />
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-sm align-middle mb-0">
                        <thead className="text-secondary small"><tr><th className="ps-3">Product ID</th><th>Name</th><th>Min. qty</th><th className="pe-3">Alert qty</th></tr></thead>
                        <tbody>
                          {d.lowStock.map((p) => (
                            <tr key={p.id}>
                              <td className="ps-3">{p.sku}</td>
                              <td>{p.name}</td>
                              <td>{p.min_stock_level}</td>
                              <td className="pe-3 fw-semibold text-danger">{p.current_stock}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="col-lg-6">
                <div className="card border-0 shadow-sm h-100">
                  <div className="d-flex justify-content-between align-items-center p-3 pb-2">
                    <span className="fw-semibold">Top Selling List</span>
                    <Link to="/products" className="small">View all</Link>
                  </div>
                  {d.topSelling.length === 0 ? (
                    <Empty text="No sales yet." />
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-sm align-middle mb-0">
                        <thead className="text-secondary small"><tr><th className="ps-3">Name</th><th>Sold qty</th><th>Remaining qty</th><th className="pe-3">Price</th></tr></thead>
                        <tbody>
                          {d.topSelling.map((p) => (
                            <tr key={p.id}>
                              <td className="ps-3">{p.name}</td>
                              <td>{p.sold_qty}</td>
                              <td>{p.remaining_qty}</td>
                              <td className="pe-3">{money(p.selling_price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </DataState>
    </>
  );
}

// Admin and Manager get the analytics view; Cashier and Staff keep the simple one
function Dashboard() {
  const { user } = useAuth();
  return MANAGERS.includes(user.role) ? <AnalyticsDashboard /> : <BasicDashboard />;
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

function Team() {
    const [form, setForm] = useState({ email: '', role: 'STAFF' });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (event) => {
      event.preventDefault();
      setSaving(true);
      try {
        const { data } = await api.post('/auth/invitations', form);
        toast.success(data.message);
        setForm({ email: '', role: 'STAFF' });
      } catch (err) {
        toast.error(getErrorMessage(err));
      } finally {
        setSaving(false);
      }
    };

    return (
      <>
        <div className="mb-3">
          <h1 className="h4 mb-1">Team invitations</h1>
          <p className="text-secondary mb-0">Invite employees to create their own account with the access level you assign.</p>
        </div>
        <div className="card border-0 shadow-sm p-3 p-md-4" style={{ maxWidth: 680 }}>
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label htmlFor="team-email" className="form-label">Email</label>
              <input id="team-email" type="email" className="form-control" value={form.email} maxLength={150} required
                onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </div>
            <div className="mb-4">
              <label htmlFor="team-role" className="form-label">Role</label>
              <select id="team-role" className="form-select" value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value })}>
                <option value="STAFF">Staff</option>
                <option value="CASHIER">Cashier</option>
                <option value="MANAGER">Manager</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Sending invitation...' : 'Send invitation'}
            </button>
          </form>
        </div>
      </>
    );
}

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

function ReceiveStockModal({ onClose, onDone, canCreateProduct }) {
  const categories = useApi('/categories');
  const categoriesRef = useRef(categories.data);
  categoriesRef.current = categories.data;
  const barcodeRef = useRef(null);
  const videoRef = useRef(null);
  const cameraControlsRef = useRef(null);
  const cameraScanHandledRef = useRef(false);
  const [barcode, setBarcode] = useState('');
  const [scanned, setScanned] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [expiryDate, setExpiryDate] = useState('');
  const [productForm, setProductForm] = useState(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [scanError, setScanError] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    barcodeRef.current?.focus();
  }, []);

  const lookupBarcode = useCallback(async (value) => {
    const code = value.trim();
    if (!code) return;
    setLookingUp(true);
    setScanError('');
    setScanned(null);
    setProductForm(null);
    setExpiryDate('');
    setNewCategoryName('');
    try {
      const { data } = await api.get(`/products/scan/${encodeURIComponent(code)}`);
      if (data.product) {
        setScanned({ type: 'existing', product: data.product });
      } else {
        const catalog = data.catalog;
        const knownCategories = categoriesRef.current || [];
        const match = knownCategories.find((category) => catalog?.categories?.some(
          (suggestion) => suggestion.toLowerCase() === category.name.toLowerCase()
        ));
        setScanned({ type: 'new', catalog });
        setProductForm({
          name: catalog?.name || '',
          sku: `BC-${code}`,
          category_id: match ? String(match.id) : '',
          brand: catalog?.brand || '',
          purchase_price: '',
          selling_price: '',
          tax_percentage: '0',
          min_stock_level: '5',
          reorder_quantity: '10',
        });
        if (!catalog) setScanError('No product details were found in the barcode catalog. Enter the product details below.');
      }
    } catch (err) {
      setScanned({ type: 'new', catalog: null });
      setProductForm({
        name: '',
        sku: `BC-${code}`,
        category_id: '',
        brand: '',
        purchase_price: '',
        selling_price: '',
        tax_percentage: '0',
        min_stock_level: '5',
        reorder_quantity: '10',
      });
      setScanError(`${getErrorMessage(err)} You can still enter the product details manually.`);
    } finally {
      setLookingUp(false);
    }
  }, []);

  useEffect(() => {
    if (!cameraActive || !videoRef.current) return undefined;
    let cancelled = false;
    const startCameraReader = async () => {
      let timeoutId;
      let requestTimedOut = false;
      try {
        const [{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (cancelled) return;
        const hints = new Map([
          [DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.AZTEC,
            BarcodeFormat.CODABAR,
            BarcodeFormat.CODE_39,
            BarcodeFormat.CODE_93,
            BarcodeFormat.CODE_128,
            BarcodeFormat.DATA_MATRIX,
            BarcodeFormat.EAN_8,
            BarcodeFormat.EAN_13,
            BarcodeFormat.ITF,
            BarcodeFormat.MAXICODE,
            BarcodeFormat.PDF_417,
            BarcodeFormat.QR_CODE,
            BarcodeFormat.RSS_14,
            BarcodeFormat.RSS_EXPANDED,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
          ]],
          [DecodeHintType.TRY_HARDER, true],
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanSuccess: 250,
          delayBetweenScanAttempts: 100,
        });
        const video = videoRef.current;
        if (!video) throw new Error('CAMERA_PREVIEW_UNAVAILABLE');
        const cameraRequest = reader.decodeFromVideoDevice(
          undefined,
          video,
          (result, _error, scanControls) => {
            if (!result) return;
            if (cancelled || requestTimedOut || cameraScanHandledRef.current) {
              scanControls.stop();
              return;
            }
            cameraScanHandledRef.current = true;
            scanControls.stop();
            if (cameraControlsRef.current === scanControls) cameraControlsRef.current = null;
            setCameraActive(false);
            setCameraLoading(false);
            const code = result.getText();
            setBarcode(code);
            lookupBarcode(code);
          }
        ).then((controls) => {
          if (cancelled || requestTimedOut || cameraScanHandledRef.current) {
            controls.stop();
            return null;
          }
          return controls;
        });
        const controls = await Promise.race([
          cameraRequest,
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              requestTimedOut = true;
              reject(new Error('CAMERA_PERMISSION_TIMEOUT'));
            }, 15000);
          }),
        ]);
        if (!controls || cancelled) return;
        cameraControlsRef.current = controls;
        setCameraLoading(false);
      } catch (error) {
        cameraControlsRef.current?.stop();
        cameraControlsRef.current = null;
        if (cancelled) return;
        setCameraActive(false);
        if (error.message === 'CAMERA_PERMISSION_TIMEOUT') {
          setCameraError('Camera permission is still waiting. Allow the browser camera prompt and try again.');
        } else if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
          setCameraError('Camera access was blocked. Allow camera permission in your browser and try again.');
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          setCameraError('No camera was found. You can scan with a handheld scanner or type the barcode.');
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
          setCameraError('The camera is busy or unavailable. Close other apps using it and try again.');
        } else {
          setCameraError('Could not start the camera. Use HTTPS or localhost, check camera permission, and try again.');
        }
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setCameraLoading(false);
      }
    };
    startCameraReader();

    return () => {
      cancelled = true;
      cameraControlsRef.current?.stop();
      cameraControlsRef.current = null;
      cameraScanHandledRef.current = false;
    };
  }, [cameraActive, lookupBarcode]);

  const stopCamera = () => {
    cameraControlsRef.current?.stop();
    cameraControlsRef.current = null;
    setCameraActive(false);
  };

  const startCamera = () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera scanning needs HTTPS or localhost and a browser that supports camera access.');
      return;
    }
    cameraScanHandledRef.current = false;
    setCameraError('');
    setCameraLoading(true);
    setCameraActive(true);
  };

  const scan = (event) => {
    event.preventDefault();
    lookupBarcode(barcode);
  };

  const setProductField = (field) => (event) => {
    setProductForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const addCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    setAddingCategory(true);
    try {
      const { data } = await api.post('/categories', { name, description: '' });
      setProductForm((current) => ({ ...current, category_id: String(data.id) }));
      setNewCategoryName('');
      categories.reload();
      toast.success('Category added.');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setAddingCategory(false);
    }
  };

  const receive = async (event) => {
    event.preventDefault();
    if (!scanned) return;
    setSaving(true);
    try {
      const response = scanned.type === 'existing'
        ? await api.post('/inventory/receive', { barcode: barcode.trim(), quantity, expiry_date: expiryDate })
        : await api.post('/inventory/receive-new', {
          ...productForm,
          barcode: barcode.trim(),
          quantity,
          expiry_date: expiryDate,
          status: 'ACTIVE',
        });
      toast.success(response.data.message);
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Scan & receive stock" onClose={onClose} size="lg">
      <form onSubmit={scan} className="mb-4">
        <label htmlFor="receive-barcode" className="form-label">Product barcode</label>
        <div className="input-group">
          <input
            ref={barcodeRef}
            id="receive-barcode"
            className="form-control"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            placeholder="Scan barcode, then press Enter"
            maxLength="50"
            autoComplete="off"
            required
          />
          <button type="submit" className="btn btn-outline-primary" disabled={lookingUp}>
            {lookingUp ? 'Looking up...' : 'Find product'}
          </button>
        </div>
        <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
          {!cameraActive ? (
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={startCamera} disabled={lookingUp}>
              <i className="bi bi-camera me-1"></i>Scan with camera
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-sm btn-outline-danger" onClick={stopCamera}>
                <i className="bi bi-camera-video-off me-1"></i>Stop camera
              </button>
              {cameraLoading && <span className="small text-secondary">Starting camera... approve the browser permission prompt.</span>}
            </>
          )}
          <span className="form-text mt-0">Or use a handheld scanner or type the barcode.</span>
        </div>
      </form>

      {cameraError && <div className="alert alert-warning py-2">{cameraError}</div>}
      {cameraActive && (
        <div className="mb-3">
          <video
            ref={videoRef}
            className="w-100 rounded bg-dark"
            style={{ maxHeight: 320, minHeight: 180, objectFit: 'contain' }}
            muted
            autoPlay
            playsInline
            aria-label="Live camera barcode preview"
          />
          <div className="form-text">{cameraLoading ? 'Waiting for camera video...' : 'Point your camera at the barcode and hold it steady.'}</div>
        </div>
      )}
      {scanError && <div className="alert alert-info py-2">{scanError}</div>}

      {scanned?.type === 'existing' && (
        <form onSubmit={receive}>
          <div className="alert alert-success">
            <div className="fw-semibold">{scanned.product.name}</div>
            <div className="small">
              {scanned.product.category_name} · Barcode {scanned.product.barcode} · Current stock {scanned.product.current_stock}
            </div>
          </div>
          <div className="row g-3">
            <div className="col-md-6">
              <label htmlFor="receive-quantity" className="form-label">Quantity received *</label>
              <input id="receive-quantity" type="number" min="1" max="1000000" required className="form-control"
                value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </div>
            <div className="col-md-6">
              <label htmlFor="receive-expiry" className="form-label">Expiry date on this package</label>
              <input id="receive-expiry" type="date" className="form-control" value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)} />
            </div>
          </div>
          <div className="form-text mt-2">Stock is increased by the received quantity. The product keeps its earliest recorded expiry date; batches are not tracked separately.</div>
          <div className="d-flex justify-content-end gap-2 mt-4">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Receiving...' : 'Receive stock'}</button>
          </div>
        </form>
      )}

      {scanned?.type === 'new' && (
        canCreateProduct ? (
          <form onSubmit={receive}>
            <div className="alert alert-warning py-2">
              New barcode. {scanned.catalog
                ? 'Name and category suggestions came from Open Food Facts; verify them before saving.'
                : 'No catalog entry was available, so enter the product details.'}
            </div>
            <div className="row g-3">
              <div className="col-md-6">
                <label htmlFor="receive-new-name" className="form-label">Product name *</label>
                <input id="receive-new-name" className="form-control" required maxLength="150"
                  value={productForm.name} onChange={setProductField('name')} />
              </div>
              <div className="col-md-3">
                <label htmlFor="receive-new-sku" className="form-label">SKU *</label>
                <input id="receive-new-sku" className="form-control" required maxLength="50"
                  value={productForm.sku} onChange={setProductField('sku')} />
              </div>
              <div className="col-md-3">
                <label htmlFor="receive-new-category" className="form-label">Category *</label>
                <select id="receive-new-category" className="form-select" required value={productForm.category_id}
                  onChange={setProductField('category_id')}>
                  <option value="">Select...</option>
                  {(categories.data || []).map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-12">
                <label htmlFor="receive-new-category-name" className="form-label">Or add a category</label>
                <div className="input-group">
                  <input id="receive-new-category-name" className="form-control" maxLength="100"
                    placeholder="e.g. Snacks" value={newCategoryName}
                    onChange={(event) => setNewCategoryName(event.target.value)} />
                  <button type="button" className="btn btn-outline-secondary" disabled={!newCategoryName.trim() || addingCategory}
                    onClick={addCategory}>
                    {addingCategory ? 'Adding...' : 'Add category'}
                  </button>
                </div>
              </div>
              <div className="col-md-4">
                <label htmlFor="receive-new-brand" className="form-label">Brand</label>
                <input id="receive-new-brand" className="form-control" maxLength="100"
                  value={productForm.brand} onChange={setProductField('brand')} />
              </div>
              <div className="col-md-4">
                <label htmlFor="receive-new-purchase" className="form-label">Purchase price *</label>
                <input id="receive-new-purchase" type="number" min="0" step="0.01" required className="form-control"
                  value={productForm.purchase_price} onChange={setProductField('purchase_price')} />
              </div>
              <div className="col-md-4">
                <label htmlFor="receive-new-selling" className="form-label">Selling price *</label>
                <input id="receive-new-selling" type="number" min="0" step="0.01" required className="form-control"
                  value={productForm.selling_price} onChange={setProductField('selling_price')} />
              </div>
              <div className="col-md-6">
                <label htmlFor="receive-new-quantity" className="form-label">Quantity received *</label>
                <input id="receive-new-quantity" type="number" min="1" max="1000000" required className="form-control"
                  value={quantity} onChange={(event) => setQuantity(event.target.value)} />
              </div>
              <div className="col-md-6">
                <label htmlFor="receive-new-expiry" className="form-label">Expiry date on this package</label>
                <input id="receive-new-expiry" type="date" className="form-control" value={expiryDate}
                  onChange={(event) => setExpiryDate(event.target.value)} />
              </div>
              <div className="col-md-4">
                <label htmlFor="receive-new-tax" className="form-label">Tax %</label>
                <input id="receive-new-tax" type="number" min="0" max="100" step="0.01" className="form-control"
                  value={productForm.tax_percentage} onChange={setProductField('tax_percentage')} />
              </div>
              <div className="col-md-4">
                <label htmlFor="receive-new-min" className="form-label">Minimum stock</label>
                <input id="receive-new-min" type="number" min="0" className="form-control"
                  value={productForm.min_stock_level} onChange={setProductField('min_stock_level')} />
              </div>
              <div className="col-md-4">
                <label htmlFor="receive-new-reorder" className="form-label">Reorder quantity</label>
                <input id="receive-new-reorder" type="number" min="0" className="form-control"
                  value={productForm.reorder_quantity} onChange={setProductField('reorder_quantity')} />
              </div>
            </div>
            <div className="form-text mt-2">Open Food Facts can suggest a name, brand, and category. Verify the details and enter your prices, expiry, and received quantity.</div>
            <div className="d-flex justify-content-end gap-2 mt-4">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || categories.loading}>
                {saving ? 'Saving product...' : 'Create product & receive stock'}
              </button>
            </div>
          </form>
        ) : (
          <div className="alert alert-warning mb-0">This barcode is not registered. Ask an Admin or Manager to add it as a product before receiving stock.</div>
        )
      )}
    </Modal>
  );
}

const VOICE_LANGUAGES = [
  ['en-US', 'English'],
  ['hi-IN', 'हिन्दी'],
  ['ta-IN', 'தமிழ்'],
  ['te-IN', 'తెలుగు'],
  ['kn-IN', 'ಕನ್ನಡ'],
  ['ml-IN', 'മലയാളം'],
];

const VOICE_SPEECH = {
  'en-US': { received: 'You have received', units: 'units of', expiry: 'Expiry date', missing: 'not provided', confirm: 'Please review and confirm.' },
  'hi-IN': { received: 'आपको प्राप्त हुए', units: 'पैकेट', expiry: 'समाप्ति तिथि', missing: 'नहीं दी गई', confirm: 'कृपया जानकारी की जाँच करके पुष्टि करें।' },
  'ta-IN': { received: 'நீங்கள் பெற்றது', units: 'அலகுகள்', expiry: 'காலாவதி தேதி', missing: 'வழங்கப்படவில்லை', confirm: 'சரிபார்த்து உறுதிப்படுத்தவும்.' },
  'te-IN': { received: 'మీరు స్వీకరించినవి', units: 'యూనిట్లు', expiry: 'గడువు తేదీ', missing: 'ఇవ్వలేదు', confirm: 'దయచేసి పరిశీలించి నిర్ధారించండి.' },
  'kn-IN': { received: 'ನೀವು ಸ್ವೀಕರಿಸಿದ್ದು', units: 'ಘಟಕಗಳು', expiry: 'ಮುಕ್ತಾಯ ದಿನಾಂಕ', missing: 'ನೀಡಲಾಗಿಲ್ಲ', confirm: 'ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ ದೃಢೀಕರಿಸಿ.' },
  'ml-IN': { received: 'നിങ്ങൾ സ്വീകരിച്ചത്', units: 'യൂണിറ്റുകൾ', expiry: 'കാലാവധി തീയതി', missing: 'നൽകിയിട്ടില്ല', confirm: 'പരിശോധിച്ച് സ്ഥിരീകരിക്കുക.' },
};

function VoiceInventoryAssistant({ onClose, onManual, onSaved }) {
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem('smartbiz-voice-language');
    return VOICE_LANGUAGES.some(([code]) => code === saved) ? saved : 'en-US';
  });
  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [extractionSource, setExtractionSource] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const recognitionRef = useRef(null);
  const candidateSearchRef = useRef({});

  useEffect(() => () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    window.speechSynthesis?.cancel();
  }, []);

  const changeLanguage = (event) => {
    const nextLanguage = event.target.value;
    setLanguage(nextLanguage);
    localStorage.setItem('smartbiz-voice-language', nextLanguage);
  };

  const startRecording = () => {
    setError('');
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError('Speech recognition is not available in this browser. Type the delivery details or use manual inventory entry.');
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.lang = language;
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onresult = (event) => {
        const words = Array.from(event.results).map((result) => result[0].transcript).join(' ');
        setTranscript(words);
      };
      recognition.onerror = (event) => {
        const errors = {
          'not-allowed': 'Microphone permission was denied. Allow microphone access or type the delivery details.',
          'service-not-allowed': 'Microphone access is blocked by the browser. Type the delivery details or use manual entry.',
          'no-speech': 'No speech was detected. Try again or type the delivery details.',
          network: 'Speech recognition could not reach its service. Check your connection or type the details.',
          'audio-capture': 'No microphone was found. Connect a microphone or type the delivery details.',
        };
        setError(errors[event.error] || 'Speech recognition failed. Try again or type the delivery details.');
        setRecording(false);
      };
      recognition.onend = () => setRecording(false);
      recognitionRef.current = recognition;
      recognition.start();
      setRecording(true);
    } catch (recognitionError) {
      setError(recognitionError.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow microphone access or type the delivery details.'
        : 'Unable to start speech recognition. Check microphone permissions or type the details.');
      setRecording(false);
    }
  };

  const extract = async (event) => {
    event.preventDefault();
    setExtracting(true);
    setError('');
    setReviewed(false);
    try {
      const response = await api.post('/inventory/voice/preview', { transcript, language });
      setItems(response.data.items);
      setExtractionSource(response.data.source);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setExtracting(false);
    }
  };

  const updateItem = (index, field, value) => {
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      if (field === 'product_name') {
        return {
          ...item,
          product_name: value,
          product_id: null,
          candidates: [],
          match_confidence: 'none',
          product_name_too_long: false,
        };
      }
      return {
        ...item,
        [field]: value,
        ...(field === 'brand' ? { brand_too_long: false } : {}),
      };
    }));
    setReviewed(false);
  };

  const searchProducts = async (index, name) => {
    const requestId = (candidateSearchRef.current[index] || 0) + 1;
    candidateSearchRef.current[index] = requestId;
    if (name.trim().length < 2) {
      setItems((current) => current.map((item, itemIndex) => itemIndex === index
        ? { ...item, candidates: [] }
        : item));
      return;
    }
    try {
      const response = await api.get('/products', { params: { search: name.trim(), status: 'ACTIVE', limit: 20 } });
      if (requestId !== candidateSearchRef.current[index]) return;
      setItems((current) => current.map((item, itemIndex) => itemIndex === index && item.product_name === name
        ? {
          ...item,
          candidates: response.data.data.map((product) => ({
            id: product.id,
            name: product.name,
            brand: product.brand,
            supplier_name: product.supplier_name,
            sku: product.sku,
            current_stock: product.current_stock,
          })),
          match_confidence: response.data.data.length ? 'low' : 'none',
        }
        : item));
    } catch (err) {
      if (requestId === candidateSearchRef.current[index]) setError(getErrorMessage(err));
    }
  };

  const duplicateIndices = new Set();
  const seenProducts = new Set();
  items.forEach((item, index) => {
    const keys = [
      item.product_id ? `product:${item.product_id}` : '',
      String(item.product_name || '').trim().toLocaleLowerCase(),
    ].filter(Boolean);
    if (keys.some((key) => seenProducts.has(key))) duplicateIndices.add(index);
    keys.forEach((key) => {
      if (seenProducts.has(key)) duplicateIndices.add(index);
      seenProducts.add(key);
    });
  });
  const validItems = items.length > 0 && items.every((item) =>
    Number.isInteger(Number(item.product_id)) && Number(item.product_id) > 0
    && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0 && Number(item.quantity) <= 1000000
    && (!item.expiry_date || /^\d{4}-\d{2}-\d{2}$/.test(item.expiry_date))
  ) && duplicateIndices.size === 0;

  const readBack = () => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setError('Text-to-speech is not available in this browser.');
      return;
    }
    const words = VOICE_SPEECH[language];
    const dateFormatter = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' });
    const text = items.map((item) => {
      const expiry = item.expiry_date
        ? dateFormatter.format(new Date(`${item.expiry_date}T12:00:00`))
        : words.missing;
      return `${words.received} ${item.quantity || '?'} ${words.units} ${item.product_name || 'unknown product'}. ${words.expiry}: ${expiry}.`;
    }).join(' ') + ` ${words.confirm}`;
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = language;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const confirm = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post('/inventory/voice/confirm', {
        confirmed: true,
        items: items.map((item) => ({
          product_id: Number(item.product_id),
          quantity: Number(item.quantity),
          expiry_date: item.expiry_date || null,
        })),
      });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Voice stock assistant" onClose={onClose} size="lg">
      <div className="mb-3">
        <label htmlFor="voice-language" className="form-label">Preferred language</label>
        <select id="voice-language" className="form-select" value={language} onChange={changeLanguage}>
          {VOICE_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </div>
      <form onSubmit={extract}>
        <label htmlFor="voice-transcript" className="form-label">Recognized speech preview — edit before extraction</label>
        <textarea id="voice-transcript" className="form-control mb-2" rows="3" maxLength="5000"
          value={transcript} onChange={(event) => setTranscript(event.target.value)}
          placeholder="For example: Received 20 packets of biscuits, 2 kg rice, and 10 strips of paracetamol." />
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className={`btn ${recording ? 'btn-danger' : 'btn-outline-primary'}`}
            onClick={recording ? () => recognitionRef.current?.stop() : startRecording} disabled={extracting || saving}>
            {recording
              ? <><span className="spinner-grow spinner-grow-sm me-2" aria-hidden="true"></span>Stop recording</>
              : <><i className="bi bi-mic-fill me-1" aria-hidden="true"></i>Record delivery</>}
          </button>
          <button className="btn btn-primary" disabled={extracting || saving || !transcript.trim()}>
            {extracting ? 'Extracting...' : 'Review extracted stock'}
          </button>
          <button type="button" className="btn btn-link" onClick={onManual}>Use manual inventory entry</button>
        </div>
      </form>

      {error && <div className="alert alert-danger mt-3 mb-0" role="alert">{error}</div>}

      {items.length > 0 && (
        <div className="mt-4">
          {extractionSource === 'offline' && (
            <div className="alert alert-info py-2" role="status">
              Offline extraction uses simple receipt phrases and supported quantity units only. Verify every field carefully.
            </div>
          )}
          <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
            <h3 className="h6 mb-0">Review before saving — nothing is saved yet</h3>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={readBack}>
              <i className="bi bi-volume-up me-1" aria-hidden="true"></i>Read back
            </button>
          </div>
          {items.map((item, index) => {
            const warnings = item.warnings.filter((warning) => {
              if (item.product_id && warning.includes('Product match is uncertain')) return false;
              if (item.product_id && warning.startsWith('Brand does not match')) return false;
              if (item.product_name && warning === 'Product name is missing.') return false;
              if (!item.product_name_too_long && warning === 'Product name is too long. Correct it before confirming.') return false;
              if (!item.brand_too_long && warning === 'Brand name is too long. Correct it before confirming.') return false;
              if (item.quantity && warning === 'Quantity is missing or invalid.') return false;
              if (item.expiry_date && warning.includes('expiry date')) return false;
              if ((item.product_id || item.candidates.length > 0) && warning.startsWith('No matching product was found')) return false;
              if (warning.startsWith('Possible duplicate of')) return false;
              return true;
            });
            const duplicated = duplicateIndices.has(index);
            return (
              <div className="card mb-3" key={`${index}-${item.product_name}`}>
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <span className={`badge ${item.match_confidence === 'high' ? 'bg-success' : 'bg-warning text-dark'}`}>
                      {item.product_id ? 'Selected shop product' : item.match_confidence === 'high' ? 'High catalog match' : 'Review product match'}
                    </span>
                    <button type="button" className="btn btn-sm btn-outline-danger" aria-label={`Remove product ${index + 1}`}
                      onClick={() => { setItems((current) => current.filter((_, itemIndex) => itemIndex !== index)); setReviewed(false); }}>
                      <i className="bi bi-trash" aria-hidden="true"></i>
                    </button>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label" htmlFor={`voice-product-${index}`}>Product mentioned</label>
                      <input id={`voice-product-${index}`} className="form-control" value={item.product_name || ''}
                        maxLength="150" onChange={(event) => {
                          const name = event.target.value;
                          updateItem(index, 'product_name', name);
                          searchProducts(index, name);
                        }} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor={`voice-match-${index}`}>Shop product</label>
                      <select id={`voice-match-${index}`} className="form-select" value={item.product_id || ''}
                        onChange={(event) => updateItem(index, 'product_id', event.target.value ? Number(event.target.value) : null)}>
                        <option value="">Select a product</option>
                        {item.candidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}{candidate.brand ? ` — ${candidate.brand}` : ''}
                            {candidate.supplier_name ? `, supplier ${candidate.supplier_name}` : ''} ({candidate.sku}, stock {candidate.current_stock})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label" htmlFor={`voice-quantity-${index}`}>Received quantity</label>
                      <input id={`voice-quantity-${index}`} type="number" min="1" max="1000000" step="1" className="form-control"
                        value={item.quantity ?? ''} onChange={(event) => updateItem(index, 'quantity', event.target.value === '' ? null : Number(event.target.value))} />
                    </div>
                    <div className="col-md-5">
                      <label className="form-label" htmlFor={`voice-expiry-${index}`}>Expiry date (optional)</label>
                      <input id={`voice-expiry-${index}`} type="date" className="form-control" value={item.expiry_date || ''}
                        onChange={(event) => updateItem(index, 'expiry_date', event.target.value || null)} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" htmlFor={`voice-brand-${index}`}>Brand heard</label>
                      <input id={`voice-brand-${index}`} className="form-control" value={item.brand || ''}
                        maxLength="100" onChange={(event) => updateItem(index, 'brand', event.target.value)} />
                    </div>
                  </div>
                  {(warnings.length > 0 || !item.expiry_date || duplicated) && (
                    <div className="alert alert-warning py-2 mt-3 mb-0">
                      <strong>Check before confirming:</strong>
                      <ul className="mb-0 mt-1">
                        {warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}
                        {!item.expiry_date && <li>Expiry date was not provided. Confirm that no expiry date needs recording.</li>}
                        {duplicated && <li>Possible duplicate product entry. Remove or correct one entry before confirming.</li>}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div className="form-check mb-3">
            <input id="voice-reviewed" className="form-check-input" type="checkbox" checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)} />
            <label htmlFor="voice-reviewed" className="form-check-label">
              I reviewed every field and confirmed any missing or uncertain information is correct.
            </label>
          </div>
          <div className="d-flex justify-content-end gap-2">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-success" onClick={confirm}
              disabled={saving || !reviewed || !validItems}>
              {saving ? 'Saving stock...' : 'Confirm and receive stock'}
            </button>
          </div>
        </div>
      )}
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
  const [receive, setReceive] = useState(false);
  const [voice, setVoice] = useState(false);
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
        {canAdjust && (
          <div className="d-flex gap-2">
            <button className="btn btn-outline-primary" onClick={() => setReceive(true)}><i className="bi bi-upc-scan me-1"></i>Scan & receive stock</button>
            <button className="btn btn-primary" onClick={() => setAdjust(true)}><i className="bi bi-sliders me-1"></i>Adjust stock</button>
          </div>
        )}
      </div>
      {canAdjust && (
        <button type="button" className="btn btn-primary position-fixed bottom-0 start-0 m-4 rounded-pill shadow"
          style={{ zIndex: 1040 }} onClick={() => setVoice(true)}>
          <i className="bi bi-mic-fill me-2" aria-hidden="true"></i>Voice stock
        </button>
      )}

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
                  {rows.map((t) => {
                    const transactionType = typeof t.type === 'string' && t.type.trim() ? t.type : null;
                    return (
                      <tr key={t.id}>
                        <td className="text-nowrap">{fmtDate(t.created_at)}</td>
                        <td>{t.product_name}<div className="small text-secondary">{t.sku}</div></td>
                        <td>
                          <span className={`badge bg-${TX_COLORS[transactionType] || 'secondary'}`}>
                            {transactionType ? transactionType.replace('_', ' ') : 'Unknown type'}
                          </span>
                        </td>
                        <td className={t.quantity_change > 0 ? 'text-success fw-semibold' : 'text-danger fw-semibold'}>{t.quantity_change > 0 ? '+' : ''}{t.quantity_change}</td>
                        <td>{t.stock_after}</td>
                        <td>{t.note || '-'}</td>
                        <td>{t.user_name || '-'}</td>
                      </tr>
                    );
                  })}
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
      {receive && <ReceiveStockModal onClose={() => setReceive(false)} onDone={() => { setReceive(false); summary.reload(); list.reload(); }} canCreateProduct={MANAGERS.includes(user.role)} />}
      {voice && <VoiceInventoryAssistant
        onClose={() => setVoice(false)}
        onManual={() => { setVoice(false); setReceive(true); }}
        onSaved={() => { setVoice(false); summary.reload(); list.reload(); toast.success('Confirmed voice stock updates saved.'); }}
      />}
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
      <Route path="/register" element={<Register />} />
      <Route path="/accept-invitation" element={<AcceptInvitation />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/assistant" element={<SmartBizAssistant />} />
        <Route path="/products" element={<Products />} />
        <Route path="/categories" element={<ProtectedRoute roles={MANAGERS}><Categories /></ProtectedRoute>} />
        <Route path="/suppliers" element={<ProtectedRoute roles={MANAGERS}><Suppliers /></ProtectedRoute>} />
        <Route path="/team" element={<ProtectedRoute roles={ADMINS}><Team /></ProtectedRoute>} />
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