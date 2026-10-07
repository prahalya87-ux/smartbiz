require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

// ---------- Database ----------
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  dateStrings: true, // dates come back as plain text like 2026-10-02
  connectionLimit: 10,
});

// ---------- Helpers ----------
const logAction = async (userId, action, entity, entityId, details, ip) => {
  try {
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address) VALUES (?,?,?,?,?,?)',
      [userId, action, entity, entityId || null, details ? JSON.stringify(details) : null, ip || null]
    );
  } catch (err) {
    console.error('Audit log failed:', err.message); // never break the request
  }
};

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });

// ---------- Middleware ----------
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }
  next();
};

const authenticate = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Please log in to continue.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.is_active, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [payload.id]
    );
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ message: 'Account not found or disabled.' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Session expired. Please log in again.' });
  }
};

// Usage: authorize('ADMIN', 'MANAGER')
const authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ message: 'You do not have permission to do this.' });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again in 15 minutes.' },
});

// ---------- App ----------
const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Allow the configured client, plus any localhost port while developing
app.use(
  cors({
    origin: (origin, cb) => {
      const ok =
        !origin ||
        origin === process.env.CLIENT_URL ||
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      cb(null, ok);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---------- Auth routes ----------
app.post(
  '/api/auth/login',
  loginLimiter,
  body('email').trim().toLowerCase().isEmail().withMessage('Please enter a valid email.'),
  body('password').notEmpty().withMessage('Password is required.'),
  validate,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const [rows] = await pool.query(
        `SELECT u.id, u.name, u.email, u.password_hash, u.is_active, r.name AS role
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?`,
        [email]
      );
      const user = rows[0];
      const ok = user && user.is_active && (await bcrypt.compare(password, user.password_hash));
      if (!ok) return res.status(401).json({ message: 'Invalid email or password.' }); // same message for both cases
      await logAction(user.id, 'LOGIN', 'user', user.id, null, req.ip);
      res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (err) {
      next(err);
    }
  }
);

// Admin-only: create a user
app.post(
  '/api/auth/register',
  authenticate,
  authorize('ADMIN'),
  body('name').trim().notEmpty().withMessage('Name is required.'),
  body('email').trim().toLowerCase().isEmail().withMessage('Please enter a valid email.'),
  body('password')
    .isStrongPassword({ minLength: 8, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 })
    .withMessage('Password must be 8+ characters with uppercase, lowercase, number and symbol.'),
  body('role').isIn(['ADMIN', 'MANAGER', 'CASHIER', 'STAFF']).withMessage('Please select a valid role.'),
  validate,
  async (req, res, next) => {
    try {
      const { name, email, password, role } = req.body;
      const [[roleRow]] = await pool.query('SELECT id FROM roles WHERE name = ?', [role]);
      const [dup] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
      if (dup[0]) return res.status(409).json({ message: 'This email is already registered.' });
      const hash = await bcrypt.hash(password, 10);
      const [result] = await pool.query(
        'INSERT INTO users (name, email, password_hash, role_id) VALUES (?,?,?,?)',
        [name, email, hash, roleRow.id]
      );
      await logAction(req.user.id, 'CREATE', 'user', result.insertId, { email, role }, req.ip);
      res.status(201).json({ message: 'User created successfully.', id: result.insertId });
    } catch (err) {
      next(err);
    }
  }
);

app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));

app.post('/api/auth/logout', authenticate, async (req, res) => {
  await logAction(req.user.id, 'LOGOUT', 'user', req.user.id, null, req.ip);
  res.json({ message: 'Logged out successfully.' });
});

// ================= PHASE 3: categories, suppliers, products, inventory =================
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const MANAGERS = ['ADMIN', 'MANAGER'];

// Turns MySQL errors into friendly messages
const dbError = (err, dupMsgs = {}, inUseMsg = 'This record is in use and cannot be deleted.') => {
  if (err.code === 'ER_DUP_ENTRY') {
    const key = Object.keys(dupMsgs).find((k) => err.sqlMessage.includes(k));
    throw httpError(409, dupMsgs[key] || 'A record with this value already exists.');
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') throw httpError(400, 'Please select a valid category or supplier.');
  if (err.code === 'ER_ROW_IS_REFERENCED_2') throw httpError(409, inUseMsg);
  throw err;
};

async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// EVERY stock change goes through here: updates stock, blocks negatives, records a transaction
async function changeStock(conn, productId, change, type, userId, note, refType = null, refId = null) {
  const [[p]] = await conn.query('SELECT current_stock FROM products WHERE id = ? FOR UPDATE', [productId]);
  if (!p) throw httpError(400, 'Invalid product ID.');
  const after = p.current_stock + change;
  if (after < 0) throw httpError(400, 'Quantity cannot be greater than available stock.');
  await conn.query('UPDATE products SET current_stock = ? WHERE id = ?', [after, productId]);
  await conn.query(
    `INSERT INTO stock_transactions (product_id, type, quantity_change, stock_after, reference_type, reference_id, note, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [productId, type, change, after, refType, refId, note || null, userId || null]
  );
  return after;
}

// Creates alerts for low/out of stock and expiry, and clears ones that no longer apply
async function syncAlerts() {
  const [rows] = await pool.query(
    `SELECT id, name, current_stock, min_stock_level, DATEDIFF(expiry_date, CURDATE()) AS days_left
     FROM products WHERE status = 'ACTIVE'`
  );
  for (const p of rows) {
    const alerts = [];
    if (p.current_stock === 0) alerts.push(['OUT_OF_STOCK', 'CRITICAL', `${p.name} is out of stock.`]);
    else if (p.current_stock <= p.min_stock_level)
      alerts.push(['LOW_STOCK', 'WARNING', `${p.name} is low on stock (${p.current_stock} left, minimum ${p.min_stock_level}).`]);
    if (p.days_left !== null) {
      if (p.days_left < 0) alerts.push(['EXPIRED', 'CRITICAL', `${p.name} has expired.`]);
      else if (p.days_left <= 30) alerts.push(['EXPIRING', 'WARNING', `${p.name} expires in ${p.days_left} day(s).`]);
    }
    const keep = alerts.map((a) => a[0]);
    await pool.query(
      `DELETE FROM notifications WHERE product_id = ? AND is_read = FALSE
       AND type IN ('LOW_STOCK','OUT_OF_STOCK','EXPIRING','EXPIRED') ${keep.length ? 'AND type NOT IN (?)' : ''}`,
      keep.length ? [p.id, keep] : [p.id]
    );
    for (const [type, severity, message] of alerts) {
      const [ex] = await pool.query(
        'SELECT id FROM notifications WHERE product_id = ? AND type = ? AND is_read = FALSE LIMIT 1', [p.id, type]);
      if (!ex[0]) {
        await pool.query('INSERT INTO notifications (type, severity, message, product_id) VALUES (?,?,?,?)',
          [type, severity, message, p.id]);
      }
    }
  }
}
if (process.argv[2] !== 'seed') setTimeout(() => syncAlerts().catch((e) => console.error('Alert sync failed:', e.message)), 1000);

// ---------- Image upload (type + size validated) ----------
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
      ? cb(null, true)
      : cb(httpError(400, 'Only JPG, PNG or WEBP images are allowed.')),
});
const uploadImage = (req, res, next) =>
  upload.single('image')(req, res, (err) => {
    if (err) return next(err.code === 'LIMIT_FILE_SIZE' ? httpError(400, 'Image must be under 2 MB.') : err);
    next();
  });

// ---------- Categories + Suppliers (same CRUD pattern) ----------
function mountCrud(route, table, fields, rules, dupMsgs, inUseMsg) {
  const pick = (b) => fields.map((f) => emptyToNull(b[f]));

  app.get(`/api/${route}`, authenticate, wrap(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM ${table} WHERE name LIKE ? ORDER BY name`, [`%${req.query.search || ''}%`]);
    res.json(rows);
  }));

  app.post(`/api/${route}`, authenticate, authorize(...MANAGERS), rules, validate, wrap(async (req, res) => {
    try {
      const [r] = await pool.query(
        `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, pick(req.body));
      await logAction(req.user.id, 'CREATE', route, r.insertId, null, req.ip);
      res.status(201).json({ message: 'Saved successfully.', id: r.insertId });
    } catch (err) { dbError(err, dupMsgs, inUseMsg); }
  }));

  app.put(`/api/${route}/:id`, authenticate, authorize(...MANAGERS), rules, validate, wrap(async (req, res) => {
    try {
      const [r] = await pool.query(
        `UPDATE ${table} SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, [...pick(req.body), req.params.id]);
      if (!r.affectedRows) return res.status(404).json({ message: 'Record not found.' });
      await logAction(req.user.id, 'UPDATE', route, Number(req.params.id), null, req.ip);
      res.json({ message: 'Saved successfully.' });
    } catch (err) { dbError(err, dupMsgs, inUseMsg); }
  }));

  app.delete(`/api/${route}/:id`, authenticate, authorize(...MANAGERS), wrap(async (req, res) => {
    try {
      const [r] = await pool.query(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!r.affectedRows) return res.status(404).json({ message: 'Record not found.' });
      await logAction(req.user.id, 'DELETE', route, Number(req.params.id), null, req.ip);
      res.json({ message: 'Deleted successfully.' });
    } catch (err) { dbError(err, dupMsgs, inUseMsg); }
  }));
}

mountCrud('categories', 'categories', ['name', 'description'],
  [body('name').trim().notEmpty().withMessage('Category name is required.')],
  { name: 'This category already exists.' }, 'This category has products and cannot be deleted.');

mountCrud('suppliers', 'suppliers',
  ['name', 'company_name', 'phone', 'email', 'address', 'tax_number', 'status'],
  [
    body('name').trim().notEmpty().withMessage('Supplier name is required.'),
    body('phone').trim().notEmpty().withMessage('Phone number is required.'),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Please enter a valid email.'),
    body('status').optional().isIn(['ACTIVE', 'INACTIVE']).withMessage('Invalid status.'),
  ],
  { email: 'This supplier email already exists.' }, 'This supplier has purchase history and cannot be deleted.');

// ---------- Products ----------
const PRODUCT_SELECT = `SELECT p.*, c.name AS category_name, s.name AS supplier_name,
  DATEDIFF(p.expiry_date, CURDATE()) AS days_left
  FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers s ON s.id = p.supplier_id`;

const productRules = [
  body('name').trim().notEmpty().withMessage('Product name is required.'),
  body('sku').trim().notEmpty().withMessage('SKU is required.'),
  body('category_id').isInt({ min: 1 }).withMessage('Please select a valid category.'),
  body('supplier_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Please select a valid supplier.'),
  body('purchase_price').isFloat({ min: 0 }).withMessage('Purchase price must be a positive number.'),
  body('selling_price').isFloat({ min: 0 }).withMessage('Selling price must be a positive number.'),
  body('tax_percentage').optional({ values: 'falsy' }).isFloat({ min: 0, max: 100 }).withMessage('Tax must be between 0 and 100.'),
  body('current_stock').optional({ values: 'falsy' }).isInt({ min: 0 }).withMessage('Stock cannot be negative.'),
  body('min_stock_level').optional({ values: 'falsy' }).isInt({ min: 0 }).withMessage('Minimum stock cannot be negative.'),
  body('reorder_quantity').optional({ values: 'falsy' }).isInt({ min: 0 }).withMessage('Reorder quantity cannot be negative.'),
  body('expiry_date').optional({ values: 'falsy' }).isISO8601().withMessage('Please enter a valid expiry date.'),
];
const productDup = { sku: 'This SKU already exists.', barcode: 'This barcode already exists.' };

app.get('/api/products', authenticate, wrap(async (req, res) => {
  const { search, category_id, supplier_id, status, alert, sort = 'name', dir = 'asc' } = req.query;
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 200);
  const where = [];
  const args = [];
  if (search) { where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)'); const s = `%${search}%`; args.push(s, s, s); }
  if (category_id) { where.push('p.category_id = ?'); args.push(category_id); }
  if (supplier_id) { where.push('p.supplier_id = ?'); args.push(supplier_id); }
  if (status) { where.push('p.status = ?'); args.push(status); }
  if (alert === 'low') where.push('(p.current_stock > 0 AND p.current_stock <= p.min_stock_level)');
  if (alert === 'out') where.push('p.current_stock = 0');
  if (alert === 'expiring') where.push('(p.expiry_date IS NOT NULL AND p.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY))');
  const sortCols = { name: 'p.name', price: 'p.selling_price', stock: 'p.current_stock', expiry: 'p.expiry_date', created: 'p.created_at' };
  const orderBy = `${sortCols[sort] || 'p.name'} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM products p ${clause}`, args);
  const [rows] = await pool.query(`${PRODUCT_SELECT} ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...args, limit, (page - 1) * limit]);
  res.json({ data: rows, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
}));

// These two must stay above /api/products/:id
app.get('/api/products/low-stock', authenticate, wrap(async (req, res) => {
  const [rows] = await pool.query(
    `${PRODUCT_SELECT} WHERE p.status = 'ACTIVE' AND p.current_stock > 0 AND p.current_stock <= p.min_stock_level ORDER BY p.current_stock`);
  res.json(rows);
}));
app.get('/api/products/expiring', authenticate, wrap(async (req, res) => {
  const [rows] = await pool.query(
    `${PRODUCT_SELECT} WHERE p.status = 'ACTIVE' AND p.expiry_date IS NOT NULL
     AND p.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) ORDER BY p.expiry_date`);
  res.json(rows);
}));

app.get('/api/products/:id', authenticate, wrap(async (req, res) => {
  const [rows] = await pool.query(`${PRODUCT_SELECT} WHERE p.id = ?`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ message: 'Product not found.' });
  res.json(rows[0]);
}));

app.post('/api/products', authenticate, authorize(...MANAGERS), uploadImage, productRules, validate, wrap(async (req, res) => {
  const b = req.body;
  const id = await withTransaction(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO products (name, sku, barcode, category_id, supplier_id, brand, description, image_path,
        purchase_price, selling_price, tax_percentage, min_stock_level, reorder_quantity, expiry_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.name, b.sku, emptyToNull(b.barcode), b.category_id, emptyToNull(b.supplier_id), emptyToNull(b.brand),
        emptyToNull(b.description), req.file ? `/uploads/${req.file.filename}` : null, b.purchase_price, b.selling_price,
        b.tax_percentage || 0, b.min_stock_level || 5, b.reorder_quantity || 10, emptyToNull(b.expiry_date)]
    );
    const qty = parseInt(b.current_stock) || 0;
    if (qty > 0) await changeStock(conn, r.insertId, qty, 'PURCHASE', req.user.id, 'Opening stock');
    return r.insertId;
  }).catch((err) => dbError(err, productDup));
  await logAction(req.user.id, 'CREATE', 'product', id, { sku: b.sku }, req.ip);
  await syncAlerts();
  res.status(201).json({ message: 'Product added successfully.', id });
}));

app.put('/api/products/:id', authenticate, authorize(...MANAGERS), uploadImage, productRules, validate, wrap(async (req, res) => {
  const b = req.body;
  const [[exists]] = await pool.query('SELECT id FROM products WHERE id = ?', [req.params.id]);
  if (!exists) return res.status(404).json({ message: 'Product not found.' });
  try {
    await pool.query(
      `UPDATE products SET name=?, sku=?, barcode=?, category_id=?, supplier_id=?, brand=?, description=?,
        image_path=COALESCE(?, image_path), purchase_price=?, selling_price=?, tax_percentage=?,
        min_stock_level=?, reorder_quantity=?, expiry_date=?, status=? WHERE id=?`,
      [b.name, b.sku, emptyToNull(b.barcode), b.category_id, emptyToNull(b.supplier_id), emptyToNull(b.brand),
        emptyToNull(b.description), req.file ? `/uploads/${req.file.filename}` : null, b.purchase_price, b.selling_price,
        b.tax_percentage || 0, b.min_stock_level || 5, b.reorder_quantity || 10, emptyToNull(b.expiry_date),
        b.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE', req.params.id]
    );
  } catch (err) { dbError(err, productDup); }
  await logAction(req.user.id, 'UPDATE', 'product', Number(req.params.id), null, req.ip);
  await syncAlerts();
  res.json({ message: 'Product updated successfully.' });
}));

app.delete('/api/products/:id', authenticate, authorize(...MANAGERS), wrap(async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ message: 'Product not found.' });
    await logAction(req.user.id, 'DELETE', 'product', Number(req.params.id), null, req.ip);
    res.json({ message: 'Product deleted.' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      await pool.query("UPDATE products SET status = 'INACTIVE' WHERE id = ?", [req.params.id]);
      return res.json({ message: 'This product has stock history, so it was set to Inactive instead of deleted.' });
    }
    throw err;
  }
}));

// ---------- Inventory ----------
app.get('/api/inventory', authenticate, wrap(async (req, res) => {
  const [[s]] = await pool.query(
    `SELECT COUNT(*) AS total_products,
      COALESCE(SUM(current_stock), 0) AS total_units,
      COALESCE(SUM(current_stock * purchase_price), 0) AS stock_value,
      COALESCE(SUM(current_stock * selling_price), 0) AS retail_value,
      COALESCE(SUM(current_stock > 0 AND current_stock <= min_stock_level), 0) AS low_stock,
      COALESCE(SUM(current_stock = 0), 0) AS out_of_stock,
      COALESCE(SUM(expiry_date IS NOT NULL AND expiry_date >= CURDATE() AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)), 0) AS expiring,
      COALESCE(SUM(expiry_date IS NOT NULL AND expiry_date < CURDATE()), 0) AS expired
     FROM products WHERE status = 'ACTIVE'`
  );
  res.json(s);
}));

app.get('/api/inventory/transactions', authenticate, wrap(async (req, res) => {
  const { product_id, type } = req.query;
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 15, 1), 100);
  const where = [];
  const args = [];
  if (product_id) { where.push('t.product_id = ?'); args.push(product_id); }
  if (type) { where.push('t.type = ?'); args.push(type); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM stock_transactions t ${clause}`, args);
  const [rows] = await pool.query(
    `SELECT t.*, p.name AS product_name, p.sku, u.name AS user_name
     FROM stock_transactions t JOIN products p ON p.id = t.product_id LEFT JOIN users u ON u.id = t.created_by
     ${clause} ORDER BY t.id DESC LIMIT ? OFFSET ?`, [...args, limit, (page - 1) * limit]);
  res.json({ data: rows, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
}));

app.post('/api/inventory/adjustment', authenticate, authorize('ADMIN', 'MANAGER', 'STAFF'),
  [
    body('product_id').isInt({ min: 1 }).withMessage('Invalid product ID.'),
    body('type').isIn(['MANUAL_ADJUSTMENT', 'DAMAGE']).withMessage('Please select an adjustment type.'),
    body('direction').optional().isIn(['add', 'remove']).withMessage('Please choose add or remove.'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive number.'),
  ],
  validate,
  wrap(async (req, res) => {
    const { product_id, type, direction, note } = req.body;
    const qty = parseInt(req.body.quantity);
    const change = type === 'DAMAGE' || direction === 'remove' ? -qty : qty; // damaged stock always goes out
    const after = await withTransaction((conn) =>
      changeStock(conn, product_id, change, type, req.user.id, note, 'adjustment'));
    await logAction(req.user.id, 'ADJUST_STOCK', 'product', Number(product_id), { change, type }, req.ip);
    await syncAlerts();
    res.json({ message: `Stock updated. New stock: ${after}.`, stock: after });
  })
);

// ---------- Notifications ----------
app.get('/api/notifications', authenticate, wrap(async (req, res) => {
  const [items] = await pool.query('SELECT * FROM notifications ORDER BY is_read, id DESC LIMIT 50');
  const [[{ unread }]] = await pool.query('SELECT COUNT(*) AS unread FROM notifications WHERE is_read = FALSE');
  res.json({ items, unread });
}));
app.put('/api/notifications/read-all', authenticate, wrap(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = TRUE');
  res.json({ message: 'All notifications marked as read.' });
}));
app.put('/api/notifications/:id/read', authenticate, wrap(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = ?', [req.params.id]);
  res.json({ message: 'Marked as read.' });
}));
// ================= END PHASE 3 =================

// ---------- Errors ----------
app.use((req, res) => res.status(404).json({ message: 'Route not found.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err); // full detail stays in the server log only
  res.status(err.status || 500).json({
    message: err.status ? err.message : 'Something went wrong. Please try again.',
  });
});

// ---------- Seed command: npm run seed ----------
async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo data in production.');
    process.exit(1);
  }
  // DEVELOPMENT-ONLY credentials. Never use these in production.
  const users = [
    { name: 'Admin User', email: 'admin@smartbiz.com', password: 'Admin@123', role: 'ADMIN' },
    { name: 'Manager User', email: 'manager@smartbiz.com', password: 'Manager@123', role: 'MANAGER' },
    { name: 'Cashier User', email: 'cashier@smartbiz.com', password: 'Cashier@123', role: 'CASHIER' },
    { name: 'Staff User', email: 'staff@smartbiz.com', password: 'Staff@123', role: 'STAFF' },
  ];
  try {
    for (const u of users) {
      const [[role]] = await pool.query('SELECT id FROM roles WHERE name = ?', [u.role]);
      const hash = await bcrypt.hash(u.password, 10);
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role_id) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), role_id = VALUES(role_id)`,
        [u.name, u.email, hash, role.id]
      );
      console.log(`Seeded ${u.role}: ${u.email}`);
    }

    // ----- Phase 3 seed: categories, suppliers, products (safe to run more than once) -----
    const cats = ['Groceries', 'Beverages', 'Personal Care', 'Household', 'Stationery'];
    for (const c of cats) await pool.query('INSERT IGNORE INTO categories (name) VALUES (?)', [c]);

    const sups = [
      ['Fresh Farms Traders', 'Fresh Farms Pvt Ltd', '9876500001', 'sales@freshfarms.example'],
      ['Cool Drinks Agency', 'Cool Drinks Co', '9876500002', 'orders@cooldrinks.example'],
      ['Glow Distributors', 'Glow Personal Care', '9876500003', 'hello@glowdist.example'],
      ['HomeNeeds Wholesale', 'HomeNeeds Ltd', '9876500004', 'supply@homeneeds.example'],
      ['Paper Plus Supplies', 'Paper Plus', '9876500005', 'care@paperplus.example'],
    ];
    for (const s of sups) {
      await pool.query('INSERT IGNORE INTO suppliers (name, company_name, phone, email) VALUES (?,?,?,?)', s);
    }
    const [catRows] = await pool.query('SELECT id, name FROM categories');
    const [supRows] = await pool.query('SELECT id, email FROM suppliers');
    const catId = Object.fromEntries(catRows.map((r) => [r.name, r.id]));
    const supId = Object.fromEntries(supRows.map((r) => [r.email, r.id]));
    const [[admin]] = await pool.query("SELECT id FROM users WHERE email = 'admin@smartbiz.com'");

    // name, sku, category, supplier#, brand, buy, sell, tax%, stock, min stock, expiry (days from today)
    const prods = [
      ['Basmati Rice 5kg', 'GRO-001', 'Groceries', 0, 'Daawat', 420, 495, 5, 40, 10, 300],
      ['Toor Dal 1kg', 'GRO-002', 'Groceries', 0, 'Tata Sampann', 120, 145, 5, 25, 10, 200],
      ['Sunflower Oil 1L', 'GRO-003', 'Groceries', 0, 'Fortune', 130, 155, 5, 30, 8, 180],
      ['Whole Wheat Atta 5kg', 'GRO-004', 'Groceries', 0, 'Aashirvaad', 210, 245, 5, 22, 8, 120],
      ['Sugar 1kg', 'GRO-005', 'Groceries', 0, 'Madhur', 42, 50, 5, 8, 15, 365],
      ['Iodised Salt 1kg', 'GRO-006', 'Groceries', 0, 'Tata', 18, 22, 0, 50, 10, 700],
      ['Cola 750ml', 'BEV-001', 'Beverages', 1, 'Thums Up', 30, 40, 12, 60, 20, 120],
      ['Orange Juice 1L', 'BEV-002', 'Beverages', 1, 'Real', 85, 105, 12, 6, 10, 10],
      ['Mineral Water 1L', 'BEV-003', 'Beverages', 1, 'Bisleri', 12, 20, 18, 100, 30, 400],
      ['Tea Powder 500g', 'BEV-004', 'Beverages', 1, 'Tata Tea', 190, 230, 5, 18, 8, 250],
      ['Milk 1L', 'BEV-005', 'Beverages', 1, 'Amul', 52, 60, 0, 0, 10, -2],
      ['Shampoo 200ml', 'PC-001', 'Personal Care', 2, 'Clinic Plus', 95, 125, 18, 22, 8, 500],
      ['Toothpaste 150g', 'PC-002', 'Personal Care', 2, 'Colgate', 62, 80, 18, 35, 10, 600],
      ['Soap Bar 100g', 'PC-003', 'Personal Care', 2, 'Dettol', 25, 35, 18, 80, 20, 700],
      ['Face Wash 100ml', 'PC-004', 'Personal Care', 2, 'Himalaya', 110, 145, 18, 4, 6, 20],
      ['Hand Sanitizer 500ml', 'PC-005', 'Personal Care', 2, 'Dettol', 140, 180, 18, 0, 5, 15],
      ['Dish Wash Liquid 500ml', 'HOU-001', 'Household', 3, 'Vim', 70, 95, 18, 28, 10, 400],
      ['Floor Cleaner 1L', 'HOU-002', 'Household', 3, 'Lizol', 105, 140, 18, 15, 6, 450],
      ['Detergent Powder 1kg', 'HOU-003', 'Household', 3, 'Surf Excel', 98, 125, 18, 9, 10, 500],
      ['Garbage Bags 30pk', 'HOU-004', 'Household', 3, 'Presto', 60, 85, 18, 40, 10, null],
      ['LED Bulb 9W', 'HOU-005', 'Household', 3, 'Philips', 70, 110, 12, 3, 10, null],
      ['Notebook A4 200pg', 'STA-001', 'Stationery', 4, 'Classmate', 40, 60, 12, 70, 20, null],
      ['Ball Pen Blue', 'STA-002', 'Stationery', 4, 'Reynolds', 5, 10, 12, 150, 50, null],
      ['Permanent Marker', 'STA-003', 'Stationery', 4, 'Camlin', 18, 30, 12, 45, 15, null],
      ['Stapler Medium', 'STA-004', 'Stationery', 4, 'Kangaro', 55, 85, 12, 12, 5, null],
    ];
    let n = 0;
    for (const [name, sku, cat, si, brand, buy, sell, tax, stock, min, days] of prods) {
      n += 1;
      const expiry = days === null ? 'NULL' : 'DATE_ADD(CURDATE(), INTERVAL ? DAY)';
      const args = [name, sku, `890100${String(n).padStart(4, '0')}`, catId[cat], supId[sups[si][3]], brand, buy, sell, tax, min, min * 3];
      if (days !== null) args.push(days);
      const [r] = await pool.query(
        `INSERT IGNORE INTO products (name, sku, barcode, category_id, supplier_id, brand, purchase_price, selling_price,
          tax_percentage, current_stock, min_stock_level, reorder_quantity, expiry_date)
         VALUES (?,?,?,?,?,?,?,?,?,0,?,?,${expiry})`, args);
      if (r.affectedRows === 1 && stock > 0) await changeStock(pool, r.insertId, stock, 'PURCHASE', admin.id, 'Opening stock');
    }
    await syncAlerts();
    console.log('Seeded 5 categories, 5 suppliers, 25 products and alerts');
  } catch (err) {
    console.error('Seed failed:', err.message);
  } finally {
    await pool.end();
  }
}

if (process.argv[2] === 'seed') {
  seed();
} else {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`SmartBiz API running on http://localhost:${PORT}`));
}