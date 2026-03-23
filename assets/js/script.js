
const API = window.location.hostname === 'localhost'
  ? 'http://localhost:5000/api'
  : '/api';

const getToken = () => localStorage.getItem('token');

// Protect customers.html — redirect if not logged in
if (window.location.pathname.includes('customers.html') && !getToken()) {
  window.location.href = 'login.html';
}

// Load dashboard: my balance + all customers table
async function loadDashboard() {
  try {
    const res = await fetch(`${API}/accounts/dashboard`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    if (res.status === 401) { logout(); return; }
    const data = await res.json();

    // Update balance and name (replaces hardcoded "Suman" and 100000)
    document.getElementById('myAccountBalance').innerText = data.me.balance;
    document.querySelector('.my-info h2').innerText = 'Name: ' + data.me.name;

    // Rebuild customer table rows dynamically
    const tbody = document.querySelector('tbody');
    tbody.innerHTML = '';
    data.customers.forEach((c, i) => {
      const row = document.createElement('tr');
      row.className = i % 2 === 0 ? 'table-light' : 'table-info';
      row.innerHTML = `
        <td>${i + 1}</td>
        <td>${c.name}</td>
        <td>${c.email}</td>
        <td>$${parseFloat(c.balance).toFixed(2)}</td>`;
      tbody.appendChild(row);
    });
  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

// Replace old sendMoney() — now calls the real API
async function sendMoney() {
  const nameInput = document.getElementById('enterName').value.trim();
  const amount    = document.getElementById('enterAmount').value.trim();

  if (!nameInput || !amount) { alert('Please fill in both fields'); return; }

  // Your form uses just the username part, email is username@email.com
  const recipientEmail = nameInput.includes('@') ? nameInput : nameInput + '';

  const res = await fetch(`${API}/transactions/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    },
    body: JSON.stringify({ recipientEmail, amount: parseFloat(amount) })
  });

  const data = await res.json();
  if (res.ok) {
    alert(data.message);
    loadDashboard();
    loadHistory();
  } else {
    alert('Error: ' + data.error);
  }
}

// Load transaction history into the existing modal list
async function loadHistory() {
  try {
    const res = await fetch(`${API}/transactions/history`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    const history = await res.json();
    const list = document.getElementById('transaction-history-body');
    list.innerHTML = '';
    if (!history.length) {
      list.innerHTML = '<li>No transactions yet.</li>';
      return;
    }
    history.forEach(t => {
      const li = document.createElement('li');
      li.textContent = `$${t.amount} from ${t.from_name} to ${t.to_name} — ${new Date(t.created_at).toLocaleString()}`;
      list.appendChild(li);
    });
  } catch (err) {
    console.error('History error:', err);
  }
}

// Logout — clears token and redirects
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('lastLoginName');
  window.location.href = 'login.html';
}

// Auto-run on customers.html
if (window.location.pathname.includes('customers.html') && getToken()) {
  loadDashboard();
  loadHistory();
}