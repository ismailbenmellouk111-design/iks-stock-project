require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const sql = require('mssql');

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'secret-key-stock-app',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 30 * 60 * 1000
  }
}));

/* =========================
   AZURE SQL CONFIG
========================= */
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

console.log('DB_SERVER =', process.env.DB_SERVER);
console.log('DB_NAME =', process.env.DB_NAME);


async function getPool() {
  return await sql.connect(dbConfig);
}

/* =========================
   INIT DEFAULT ADMIN
========================= */
async function initDatabase() {
  const pool = await getPool();
  const check = await pool.request()
    .input('username', sql.VarChar, 'admin')
    .query('SELECT * FROM admins WHERE username=@username');

  if (check.recordset.length === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await pool.request()
      .input('username', sql.VarChar, 'admin')
      .input('password_hash', sql.VarChar, hash)
      .query('INSERT INTO admins (username,password_hash) VALUES (@username,@password_hash)');
    console.log('✅ Default admin created');
  }
}
initDatabase();

/* =========================
   AUTH
========================= */
function requireLogin(req, res, next) {
  if (!req.session.admin) return res.status(401).json({ message: 'Not authenticated' });
  next();
}

/* =========================
   STATIC FILES
========================= */
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', (req, res) => {
  if (!req.session.admin) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login.html', (req, res) => {
  if (req.session.admin) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

/* =========================
   AUTH ROUTES
========================= */
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const pool = await getPool();

  const result = await pool.request()
    .input('username', sql.VarChar, username)
    .query('SELECT * FROM admins WHERE username=@username');

  if (result.recordset.length === 0) return res.status(401).json({ message: 'Login incorrect' });

  const admin = result.recordset[0];
  const ok = await bcrypt.compare(password, admin.passwordiggor??admin.password_hash);

  if (!ok) return res.status(401).json({ message: 'Login incorrect' });

  req.session.admin = { id: admin.id, username: admin.username };
  res.json({ message: '✅ Login success' });
});

/* =========================
   HISTORIQUE HELPER
========================= */
async function createAuditLog({
  product_id,
  product_name,
  action_type,
  old_quantity = null,
  new_quantity = null,
  note = null
}) {
  const pool = await getPool();

  await pool.request()
    .input('product_id', sql.Int, product_id)
    .input('product_name', sql.VarChar, product_name)
    .input('action_type', sql.VarChar, action_type)
    .input('old_quantity', sql.Int, old_quantity)
    .input('new_quantity', sql.Int, new_quantity)
    .input('note', sql.VarChar, note)
    .query(`
      INSERT INTO audit_logs
      (product_id, product_name, action_type, old_quantity, new_quantity, note)
      VALUES
      (@product_id, @product_name, @action_type, @old_quantity, @new_quantity, @note)
    `);
}

/* =========================
   PRODUCTS CRUD
========================= */

// GET ALL PRODUCTS
app.get('/products', requireLogin, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query('SELECT * FROM products ORDER BY id ASC');

    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET ONE PRODUCT
app.get('/products/:id', requireLogin, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, Number(req.params.id))
      .query('SELECT * FROM products WHERE id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Product makaynch' });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD PRODUCT
app.post('/products', requireLogin, async (req, res) => {
  const { name, category, quantity, price, min_stock } = req.body;

  try {
    const qty = Number(quantity);
    const pr = Number(price);
    const min = min_stock !== undefined ? Number(min_stock) : 5;

    const pool = await getPool();
    const result = await pool.request()
      .input('name', sql.VarChar, name)
      .input('category', sql.VarChar, category || null)
      .input('quantity', sql.Int, isNaN(qty) ? 0 : qty)
      .input('price', sql.Decimal(10, 2), isNaN(pr) ? 0 : pr)
      .input('min_stock', sql.Int, isNaN(min) ? 5 : min)
      .query(`
        INSERT INTO products (name, category, quantity, price, min_stock)
        OUTPUT INSERTED.*
        VALUES (@name, @category, @quantity, @price, @min_stock)
      `);

    const product = result.recordset[0];

    await createAuditLog({
      product_id: product.id,
      product_name: product.name,
      action_type: 'CREATE',
      old_quantity: null,
      new_quantity: product.quantity,
      note: 'Ajout du produit'
    });

    res.status(201).json({
      message: '✅ Product tzad',
      product
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE PRODUCT
app.put('/products/:id', requireLogin, async (req, res) => {
  const { name, category, quantity, price, min_stock } = req.body;
  const id = Number(req.params.id);

  try {
    const qty = Number(quantity);
    const pr = Number(price);
    const min = Number(min_stock);

    const pool = await getPool();

    const oldResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM products WHERE id = @id');

    if (oldResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Product makaynch' });
    }

    const oldProduct = oldResult.recordset[0];

    await pool.request()
      .input('id', sql.Int, id)
      .input('name', sql.VarChar, name)
      .input('category', sql.VarChar, category || null)
      .input('quantity', sql.Int, isNaN(qty) ? oldProduct.quantity : qty)
      .input('price', sql.Decimal(10, 2), isNaN(pr) ? oldProduct.price : pr)
      .input('min_stock', sql.Int, isNaN(min) ? oldProduct.min_stock : min)
      .query(`
        UPDATE products
        SET name = @name,
            category = @category,
            quantity = @quantity,
            price = @price,
            min_stock = @min_stock
        WHERE id = @id
      `);

    const updatedResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM products WHERE id = @id');

    const updatedProduct = updatedResult.recordset[0];

    await createAuditLog({
      product_id: updatedProduct.id,
      product_name: updatedProduct.name,
      action_type: 'UPDATE',
      old_quantity: oldProduct.quantity,
      new_quantity: updatedProduct.quantity,
      note: 'Modification du produit'
    });

    res.json({
      message: '✅ Product tḥaddat',
      product: updatedProduct
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE PRODUCT
app.delete('/products/:id', requireLogin, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const pool = await getPool();

    const oldResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM products WHERE id = @id');

    if (oldResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Product makaynch' });
    }

    const product = oldResult.recordset[0];

    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM products WHERE id = @id');

    await createAuditLog({
      product_id: product.id,
      product_name: product.name,
      action_type: 'DELETE',
      old_quantity: product.quantity,
      new_quantity: null,
      note: 'Suppression du produit'
    });

    res.json({ message: '✅ Product tmsaḥ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   STOCK MANAGEMENT
========================= */

// ADD STOCK
app.put('/products/:id/add-stock', requireLogin, async (req, res) => {
  const id = Number(req.params.id);
  const quantity = Number(req.body.quantity);

  if (isNaN(quantity) || quantity <= 0) {
    return res.status(400).json({ message: 'Quantity khasha tkun > 0' });
  }

  try {
    const pool = await getPool();

    const oldResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM products WHERE id = @id');

    if (oldResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Product makaynch' });
    }

    const oldProduct = oldResult.recordset[0];

    await pool.request()
      .input('id', sql.Int, id)
      .input('quantity', sql.Int, quantity)
      .query('UPDATE products SET quantity = quantity + @quantity WHERE id = @id');

    const updatedResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM products WHERE id = @id');

    const updatedProduct = updatedResult.recordset[0];

    await createAuditLog({
      product_id: updatedProduct.id,
      product_name: updatedProduct.name,
      action_type: 'ADD_STOCK',
      old_quantity: oldProduct.quantity,
      new_quantity: updatedProduct.quantity,
      note: 'Ajout de stock'
    });

    res.json({
      message: '✅ Stock tzad',
      product: updatedProduct
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REMOVE STOCK
app.put('/products/:id/remove-stock', requireLogin, async (req, res) => {
  const id = Number(req.params.id);
  const quantity = Number(req.body.quantity);

  if (isNaN(quantity) || quantity <= 0) {
    return res.status(400).json({ message: 'Quantity khasha tkun > 0' });
  }

  try {
    const pool = await getPool();

    const oldResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM products WHERE id = @id');

    if (oldResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Product makaynch' });
    }

    const oldProduct = oldResult.recordset[0];

    if (oldProduct.quantity < quantity) {
      return res.status(400).json({ message: '❌ Stock ma kaykafich' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('quantity', sql.Int, quantity)
      .query('UPDATE products SET quantity = quantity - @quantity WHERE id = @id');

    const updatedResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM products WHERE id = @id');

    const updatedProduct = updatedResult.recordset[0];

    await createAuditLog({
      product_id: updatedProduct.id,
      product_name: updatedProduct.name,
      action_type: 'REMOVE_STOCK',
      old_quantity: oldProduct.quantity,
      new_quantity: updatedProduct.quantity,
      note: 'Retrait de stock'
    });

    res.json({
      message: '✅ Stock tnqes',
      product: updatedProduct
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LOW STOCK
app.get('/low-stock', requireLogin, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query('SELECT * FROM products WHERE quantity <= min_stock ORDER BY quantity ASC');

    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   AUDIT LOGS ROUTES
========================= */

// GET ALL AUDIT LOGS
app.get('/audit-logs', requireLogin, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query('SELECT * FROM audit_logs ORDER BY changed_at DESC, id DESC');

    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET AUDIT LOGS BY PRODUCT ID
app.get('/audit-logs/:productId', requireLogin, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('product_id', sql.Int, Number(req.params.productId))
      .query(`
        SELECT * FROM audit_logs
        WHERE product_id = @product_id
        ORDER BY changed_at DESC, id DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CLEAR AUDIT LOGS
app.delete('/audit-logs', requireLogin, async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().query('DELETE FROM audit_logs');

    res.json({ message: '✅ Historique supprimé' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   SERVER
========================= */
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});