fetch('/check-auth')
  .then(res => res.json())
  .then(data => {
    if (!data.logged) {
      window.location.href = '/login.html';
    }
  });

const API_URL = 'http://localhost:3000';

const productForm = document.getElementById('productForm');
const productsTableBody = document.getElementById('productsTableBody');
const lowStockList = document.getElementById('lowStockList');
const refreshBtn = document.getElementById('refreshBtn');
const messageBox = document.getElementById('message');
const auditTableBody = document.getElementById('auditTableBody');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const searchInput = document.getElementById('searchInput');

const editSection = document.getElementById('editSection');
const editProductForm = document.getElementById('editProductForm');
const cancelEditBtn = document.getElementById('cancelEditBtn');

const editId = document.getElementById('editId');
const editName = document.getElementById('editName');
const editCategory = document.getElementById('editCategory');
const editQuantity = document.getElementById('editQuantity');
const editPrice = document.getElementById('editPrice');
const editMinStock = document.getElementById('editMinStock');
const logoutBtn = document.getElementById('logoutBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

let allProducts = [];

function showMessage(msg) {
  messageBox.textContent = msg;
  setTimeout(() => {
    messageBox.textContent = '';
  }, 3000);
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString();
}

function formatValue(value) {
  return value === null || value === undefined ? '-' : value;
}

function getActionClass(action) {
  switch (action) {
    case 'CREATE':
      return 'audit-create';
    case 'UPDATE':
      return 'audit-update';
    case 'ADD_STOCK':
      return 'audit-add';
    case 'REMOVE_STOCK':
      return 'audit-remove';
    case 'DELETE':
      return 'audit-delete';
    default:
      return '';
  }
}

// ==============================
// PRODUCTS
// ==============================
async function fetchProducts() {
  try {
    const res = await fetch(`${API_URL}/products`);
    const products = await res.json();

    allProducts = products;
    displayProducts(products);
  } catch (error) {
    console.error('Error loading products:', error);
  }
}

function displayProducts(products) {
  productsTableBody.innerHTML = '';

  if (products.length === 0) {
    productsTableBody.innerHTML = `
      <tr>
        <td colspan="8">❌ Aucun produit trouvé</td>
      </tr>
    `;
    return;
  }

  products.forEach(product => {
    const statusClass = product.quantity <= product.min_stock ? 'low-stock' : 'ok-stock';
    const statusText = product.quantity <= product.min_stock ? 'Low Stock' : 'OK';

    const row = document.createElement('tr');

    row.innerHTML = `
      <td>${product.id}</td>
      <td>${product.name}</td>
      <td>${product.category ?? ''}</td>
      <td>${product.quantity}</td>
      <td>${product.price}</td>
      <td>${product.min_stock}</td>
      <td class="${statusClass}">${statusText}</td>
      <td>
        <div class="actions">
          <button class="btn-add" onclick="addStock(${product.id})">+ Stock</button>
          <button class="btn-remove" onclick="removeStock(${product.id})">- Stock</button>
          <button class="btn-edit" onclick="editProduct(${product.id})">Modifier</button>
          <button class="btn-delete" onclick="deleteProduct(${product.id})">Delete</button>
        </div>
      </td>
    `;

    productsTableBody.appendChild(row);
  });
}

// ==============================
// SEARCH
// ==============================
searchInput.addEventListener('input', () => {
  const keyword = searchInput.value.toLowerCase().trim();

  const filteredProducts = allProducts.filter(product =>
    product.name.toLowerCase().includes(keyword) ||
    (product.category && product.category.toLowerCase().includes(keyword))
  );

  displayProducts(filteredProducts);
});

// ==============================
// LOW STOCK
// ==============================
async function fetchLowStock() {
  try {
    const res = await fetch(`${API_URL}/low-stock`);
    const products = await res.json();

    lowStockList.innerHTML = '';

    if (products.length === 0) {
      lowStockList.innerHTML = '<li>Aucun produit en low stock</li>';
      return;
    }

    products.forEach(product => {
      const li = document.createElement('li');
      li.textContent = `${product.name} - quantité: ${product.quantity} / min: ${product.min_stock}`;
      lowStockList.appendChild(li);
    });
  } catch (error) {
    console.error('Error loading low stock:', error);
  }
}

// ==============================
// AUDIT LOGS / HISTORIQUE
// ==============================
async function fetchAuditLogs() {
  try {
    const res = await fetch(`${API_URL}/audit-logs`);
    const logs = await res.json();

    auditTableBody.innerHTML = '';

    if (!logs.length) {
      auditTableBody.innerHTML = `
        <tr>
          <td colspan="8">Aucun historique pour le moment</td>
        </tr>
      `;
      return;
    }

    logs.forEach(log => {
      const row = document.createElement('tr');
      const actionClass = getActionClass(log.action_type);

      row.innerHTML = `
        <td>${formatDate(log.changed_at)}</td>
        <td>${formatValue(log.product_name)}</td>
        <td class="${actionClass}">${formatValue(log.action_type)}</td>
        <td>${formatValue(log.old_quantity)}</td>
        <td>${formatValue(log.new_quantity)}</td>
        <td>${formatValue(log.old_price)}</td>
        <td>${formatValue(log.new_price)}</td>
        <td>${formatValue(log.note)}</td>
      `;

      auditTableBody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading audit logs:', error);
  }
}

// ==============================
// ADD PRODUCT
// ==============================
productForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('name').value;
  const category = document.getElementById('category').value;
  const quantity = document.getElementById('quantity').value;
  const price = document.getElementById('price').value;
  const min_stock = document.getElementById('min_stock').value;

  try {
    const res = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        category,
        quantity: Number(quantity),
        price: Number(price),
        min_stock: Number(min_stock)
      })
    });

    const data = await res.json();

    if (!res.ok) {
      showMessage(data.message || 'Erreur lors de l’ajout');
      return;
    }

    showMessage('✅ Produit ajouté avec succès');
    productForm.reset();
    document.getElementById('min_stock').value = 5;

    fetchProducts();
    fetchLowStock();
    fetchAuditLogs();
  } catch (error) {
    console.error('Error adding product:', error);
  }
});

// ==============================
// LOAD PRODUCT INTO EDIT FORM
// ==============================
async function editProduct(id) {
  try {
    const res = await fetch(`${API_URL}/products/${id}`);
    const product = await res.json();

    if (!res.ok) {
      showMessage(product.message || 'Erreur lors du chargement du produit');
      return;
    }

    editId.value = product.id;
    editName.value = product.name;
    editCategory.value = product.category ?? '';
    editQuantity.value = product.quantity;
    editPrice.value = product.price;
    editMinStock.value = product.min_stock;

    editSection.style.display = 'block';
    editSection.scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    console.error('Error loading product for edit:', error);
  }
}

// ==============================
// UPDATE PRODUCT
// ==============================
editProductForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = editId.value;

  try {
    const res = await fetch(`${API_URL}/products/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: editName.value,
        category: editCategory.value,
        quantity: Number(editQuantity.value),
        price: Number(editPrice.value),
        min_stock: Number(editMinStock.value)
      })
    });

    const data = await res.json();

    if (!res.ok) {
      showMessage(data.message || 'Erreur lors de la modification');
      return;
    }

    showMessage('✅ Produit modifié avec succès');

    editProductForm.reset();
    editSection.style.display = 'none';

    fetchProducts();
    fetchLowStock();
    fetchAuditLogs();
  } catch (error) {
    console.error('Error updating product:', error);
  }
});

// ==============================
// CANCEL EDIT
// ==============================
cancelEditBtn.addEventListener('click', () => {
  editProductForm.reset();
  editSection.style.display = 'none';
});

// ==============================
// ADD STOCK
// ==============================
async function addStock(id) {
  const quantity = prompt('Chhal bghiti tzid f stock?');

  if (!quantity || Number(quantity) <= 0) return;

  try {
    const res = await fetch(`${API_URL}/products/${id}/add-stock`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        quantity: Number(quantity)
      })
    });

    const data = await res.json();
    showMessage(data.message || 'Stock updated');

    fetchProducts();
    fetchLowStock();
    fetchAuditLogs();
  } catch (error) {
    console.error('Error adding stock:', error);
  }
}

// ==============================
// REMOVE STOCK
// ==============================
async function removeStock(id) {
  const quantity = prompt('Chhal bghiti tn9s mn stock?');

  if (!quantity || Number(quantity) <= 0) return;

  try {
    const res = await fetch(`${API_URL}/products/${id}/remove-stock`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        quantity: Number(quantity)
      })
    });

    const data = await res.json();
    showMessage(data.message || 'Stock updated');

    fetchProducts();
    fetchLowStock();
    fetchAuditLogs();
  } catch (error) {
    console.error('Error removing stock:', error);
  }
}

// ==============================
// DELETE PRODUCT
// ==============================
async function deleteProduct(id) {
  const confirmDelete = confirm('Wash bghiti tmse7 had product?');
  if (!confirmDelete) return;

  try {
    const res = await fetch(`${API_URL}/products/${id}`, {
      method: 'DELETE'
    });

    const data = await res.json();
    showMessage(data.message || 'Product deleted');

    fetchProducts();
    fetchLowStock();
    fetchAuditLogs();
  } catch (error) {
    console.error('Error deleting product:', error);
  }
}

// ==============================
// REFRESH BUTTONS
// ==============================
refreshBtn.addEventListener('click', () => {
  fetchProducts();
  fetchLowStock();
  fetchAuditLogs();
});

if (refreshHistoryBtn) {
  refreshHistoryBtn.addEventListener('click', () => {
    fetchAuditLogs();
  });
}
if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener('click', async () => {
    const confirmClear = confirm('Wash bghiti tmse7 ga3 lhistorique?');
    if (!confirmClear) return;

    try {
      const res = await fetch(`${API_URL}/audit-logs`, {
        method: 'DELETE'
      });

      const data = await res.json();

      if (!res.ok) {
        showMessage(data.message || 'Erreur lors de la suppression de l’historique');
        return;
      }

      showMessage(data.message || '✅ Historique supprimé');
      fetchAuditLogs();
    } catch (error) {
      console.error('Error clearing audit logs:', error);
    }
  });
}
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await fetch('/logout', {
      method: 'POST'
    });

    window.location.href = '/login.html';
  });
}

// ==============================
// INITIAL LOAD
// ==============================
fetchProducts();
fetchLowStock();
fetchAuditLogs();