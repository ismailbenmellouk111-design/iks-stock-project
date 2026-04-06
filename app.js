require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

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
    maxAge: 30 * 60 * 1000 // ✅ 30 minutes
  }
}));



const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ==============================
// INIT DATABASE + DEFAULT ADMIN
// ==============================
async function initDatabase() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ MySQL connected successfully');

    // products table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        category VARCHAR(100),
        quantity INT NOT NULL DEFAULT 0,
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        min_stock INT NOT NULL DEFAULT 5
      )
    `);

    // audit logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT,
        product_name VARCHAR(100),
        action_type VARCHAR(50) NOT NULL,
        old_quantity INT,
        new_quantity INT,
        old_price DECIMAL(10,2),
        new_price DECIMAL(10,2),
        old_category VARCHAR(100),
        new_category VARCHAR(100),
        note VARCHAR(255),
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // admins table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL
      )
    `);

    // create default admin if not exists
    const [admins] = await pool.execute(
      'SELECT * FROM admins WHERE username = ?',
      ['admin']
    );

    if (admins.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.execute(
        'INSERT INTO admins (username, password_hash) VALUES (?, ?)',
        ['admin', hashedPassword]
      );
      console.log('✅ Default admin created');
      console.log('➡️ username: admin');
      console.log('➡️ password: admin123');
    }

    connection.release();
  } catch (error) {
    console.error('❌ Database init failed:', error.message);
  }
}

initDatabase();

// ==============================
// AUTH MIDDLEWARE
// ==============================
function requireLogin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  next();
}

// ==============================
// STATIC FILES
// ==============================
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Root route
app.get('/', (req, res) => {
  if (!req.session.admin) {
    return res.redirect('/login.html');
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// login page route
app.get('/login.html', (req, res) => {
  if (req.session.admin) {
    return res.redirect('/');
  }

  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ==============================
// AUTH ROUTES
// ==============================

// check auth
app.get('/check-auth', (req, res) => {
  if (req.session.admin) {
    return res.json({
      logged: true,
      admin: req.session.admin
    });
  }

  res.json({ logged: false });
});

// login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM admins WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Login incorrect' });
    }

    const admin = rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);

    if (!match) {
      return res.status(401).json({ message: 'Login incorrect' });
    }

    req.session.admin = {
      id: admin.id,
      username: admin.username
    };

    res.json({ message: '✅ Login success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: '✅ Logged out' });
  });
});

// ==============================
// HELPER: AUDIT LOG
// ==============================
async function createAuditLog({
  productId,
  productName,
  actionType,
  oldQuantity = null,
  newQuantity = null,
  oldPrice = null,
  newPrice = null,
  oldCategory = null,
  newCategory = null,
  note = null
}) {
  await pool.execute(
    `INSERT INTO audit_logs
     (product_id, product_name, action_type, old_quantity, new_quantity, old_price, new_price, old_category, new_category, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      productId,
      productName,
      actionType,
      oldQuantity,
      newQuantity,
      oldPrice,
      newPrice,
      oldCategory,
      newCategory,
      note
    ]
  );
}

// ==============================
// GET ALL AUDIT LOGS
// ==============================
app.get('/audit-logs', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM audit_logs ORDER BY changed_at DESC, id DESC'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET AUDIT LOGS BY PRODUCT ID
app.get('/audit-logs/:productId', requireLogin, async (req, res) => {
  try {
    const { productId } = req.params;

    const [rows] = await pool.execute(
      'SELECT * FROM audit_logs WHERE product_id = ? ORDER BY changed_at DESC, id DESC',
      [productId]
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// GET ALL PRODUCTS
// ==============================
app.get('/products', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET ONE PRODUCT BY ID
app.get('/products/:id', requireLogin, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(
      'SELECT * FROM products WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Product makaynch' });
    }

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// POST ADD PRODUCT
// ==============================
app.post('/products', requireLogin, async (req, res) => {
  try {
    const { name, category, quantity, price, min_stock } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        message: 'name خاص يكون موجود وصحيح'
      });
    }

    if (quantity === undefined || isNaN(quantity) || Number(quantity) < 0) {
      return res.status(400).json({
        message: 'quantity خاصها تكون رقم 0 أو أكثر'
      });
    }

    if (price === undefined || isNaN(price) || Number(price) < 0) {
      return res.status(400).json({
        message: 'price خاصو يكون رقم 0 أو أكثر'
      });
    }

    const productCategory = category ?? null;
    const productMinStock = min_stock ?? 5;

    const [result] = await pool.execute(
      'INSERT INTO products (name, category, quantity, price, min_stock) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), productCategory, Number(quantity), Number(price), Number(productMinStock)]
    );

    const [newProductRows] = await pool.execute(
      'SELECT * FROM products WHERE id = ?',
      [result.insertId]
    );

    const newProduct = newProductRows[0];

    await createAuditLog({
      productId: newProduct.id,
      productName: newProduct.name,
      actionType: 'CREATE',
      oldQuantity: null,
      newQuantity: newProduct.quantity,
      oldPrice: null,
      newPrice: newProduct.price,
      oldCategory: null,
      newCategory: newProduct.category,
      note: 'Création du produit'
    });

    res.status(201).json({
      message: '✅ Product تزاد بنجاح',
      product: newProduct
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// PUT UPDATE FULL PRODUCT
// ==============================
app.put('/products/:id', requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, quantity, price, min_stock } = req.body;

    const [existing] = await pool.execute(
      'SELECT * FROM products WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Product makaynch' });
    }

    const currentProduct = existing[0];

    const updatedName = name ?? currentProduct.name;
    const updatedCategory = category ?? currentProduct.category;
    const updatedQuantity = quantity ?? currentProduct.quantity;
    const updatedPrice = price ?? currentProduct.price;
    const updatedMinStock = min_stock ?? currentProduct.min_stock;

    if (!updatedName || typeof updatedName !== 'string' || !updatedName.trim()) {
      return res.status(400).json({
        message: 'name خاص يكون صحيح'
      });
    }

    if (isNaN(updatedQuantity) || Number(updatedQuantity) < 0) {
      return res.status(400).json({
        message: 'quantity خاصها تكون رقم 0 أو أكثر'
      });
    }

    if (isNaN(updatedPrice) || Number(updatedPrice) < 0) {
      return res.status(400).json({
        message: 'price خاصو يكون رقم 0 أو أكثر'
      });
    }

    if (isNaN(updatedMinStock) || Number(updatedMinStock) < 0) {
      return res.status(400).json({
        message: 'min_stock خاصو يكون رقم 0 أو أكثر'
      });
    }

    await pool.execute(
      'UPDATE products SET name = ?, category = ?, quantity = ?, price = ?, min_stock = ? WHERE id = ?',
      [
        updatedName.trim(),
        updatedCategory,
        Number(updatedQuantity),
        Number(updatedPrice),
        Number(updatedMinStock),
        id
      ]
    );

    const [updatedRows] = await pool.execute(
      'SELECT * FROM products WHERE id = ?',
      [id]
    );

    const updatedProduct = updatedRows[0];

    await createAuditLog({
      productId: updatedProduct.id,
      productName: updatedProduct.name,
      actionType: 'UPDATE',
      oldQuantity: currentProduct.quantity,
      newQuantity: updatedProduct.quantity,
      oldPrice: currentProduct.price,
      newPrice: updatedProduct.price,
      oldCategory: currentProduct.category,
      newCategory: updatedProduct.category,
      note: 'Modification du produit'
    });

    res.json({
      message: '✅ Product تحدّث بنجاح',
      product: updatedProduct
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// DELETE PRODUCT
// ==============================
app.delete('/products/:id', requireLogin, async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute(
      'SELECT * FROM products WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Product makaynch' });
    }

    const productToDelete = existing[0];

    await createAuditLog({
      productId: productToDelete.id,
      productName: productToDelete.name,
      actionType: 'DELETE',
      oldQuantity: productToDelete.quantity,
      newQuantity: null,
      oldPrice: productToDelete.price,
      newPrice: null,
      oldCategory: productToDelete.category,
      newCategory: null,
      note: 'Suppression du produit'
    });

    await pool.execute(
      'DELETE FROM products WHERE id = ?',
      [id]
    );

    res.json({ message: '✅ Product tmse7 بنجاح' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// ADD STOCK
// ==============================
app.put('/products/:id/add-stock', requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;

    if (quantity === undefined || isNaN(quantity) || Number(quantity) <= 0) {
      return res.status(400).json({
        message: 'quantity خاصها تكون أكبر من 0'
      });
    }

    const [existing] = await pool.execute(
      'SELECT * FROM products WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Product makaynch' });
    }

    const currentProduct = existing[0];

    await pool.execute(
      'UPDATE products SET quantity = quantity + ? WHERE id = ?',
      [Number(quantity), id]
    );

    const [updatedRows] = await pool.execute(
      'SELECT * FROM products WHERE id = ?',
      [id]
    );

    const updatedProduct = updatedRows[0];

    await createAuditLog({
      productId: updatedProduct.id,
      productName: updatedProduct.name,
      actionType: 'ADD_STOCK',
      oldQuantity: currentProduct.quantity,
      newQuantity: updatedProduct.quantity,
      oldPrice: currentProduct.price,
      newPrice: updatedProduct.price,
      oldCategory: currentProduct.category,
      newCategory: updatedProduct.category,
      note: 'Ajout de stock'
    });

    res.json({
      message: '✅ Stock تزاد بنجاح',
      product: updatedProduct
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// REMOVE STOCK
// ==============================
app.put('/products/:id/remove-stock', requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;

    if (quantity === undefined || isNaN(quantity) || Number(quantity) <= 0) {
      return res.status(400).json({
        message: 'quantity خاصها تكون أكبر من 0'
      });
    }

    const [existing] = await pool.execute(
      'SELECT * FROM products WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Product makaynch' });
    }

    const currentProduct = existing[0];

    if (currentProduct.quantity < Number(quantity)) {
      return res.status(400).json({
        message: '❌ Stock ma kaykafich'
      });
    }

    await pool.execute(
      'UPDATE products SET quantity = quantity - ? WHERE id = ?',
      [Number(quantity), id]
    );

    const [updatedRows] = await pool.execute(
      'SELECT * FROM products WHERE id = ?',
      [id]
    );

    const updatedProduct = updatedRows[0];

    await createAuditLog({
      productId: updatedProduct.id,
      productName: updatedProduct.name,
      actionType: 'REMOVE_STOCK',
      oldQuantity: currentProduct.quantity,
      newQuantity: updatedProduct.quantity,
      oldPrice: currentProduct.price,
      newPrice: updatedProduct.price,
      oldCategory: currentProduct.category,
      newCategory: updatedProduct.category,
      note: 'Retrait de stock'
    });

    res.json({
      message: '✅ Stock tn9s بنجاح',
      product: updatedProduct
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// GET LOW STOCK PRODUCTS
// ==============================
app.get('/low-stock', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM products WHERE quantity <= min_stock ORDER BY quantity ASC'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});