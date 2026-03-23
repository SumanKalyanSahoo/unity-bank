const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const auth = require('../middleware/auth');
require('dotenv').config();

// ── Helper: generate unique account number (12 digits) ──
function generateAccountNumber() {
  return '5' + Math.floor(Math.random() * 9e11 + 1e11).toString();
}

// ── Helper: generate UPI ID from name + random number ──
function generateUpiId(name) {
  const firstName = name.trim().split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  const suffix = Math.floor(Math.random() * 9000 + 1000);
  return `${firstName}${suffix}@unitybank`;
}

// ── REGISTER ──
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, pin } = req.body;

    if (!name || !email || !password || !pin)
      return res.status(400).json({ error: 'All fields are required (name, email, password, PIN)' });

    if (!/^\d{4}$/.test(pin))
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length)
      return res.status(400).json({ error: 'This email is already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const pinHash = await bcrypt.hash(pin, 10);

    // Generate unique account number and UPI ID
    let accountNumber, upiId, accExists, upiExists;
    do {
      accountNumber = generateAccountNumber();
      accExists = await pool.query('SELECT id FROM accounts WHERE account_number=$1', [accountNumber]);
    } while (accExists.rows.length);

    do {
      upiId = generateUpiId(name);
      upiExists = await pool.query('SELECT id FROM users WHERE upi_id=$1', [upiId]);
    } while (upiExists.rows.length);

    const user = await pool.query(
      'INSERT INTO users (name, email, password_hash, pin_hash, upi_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [name, email, passwordHash, pinHash, upiId]
    );

    // Starting balance ₹0
    await pool.query(
      'INSERT INTO accounts (user_id, balance, account_number) VALUES ($1, 0.00, $2)',
      [user.rows[0].id, accountNumber]
    );

    res.json({ message: 'Account created successfully! Please login.' });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── LOGIN ──
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows.length)
      return res.status(401).json({ error: 'Invalid email or password' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: user.id, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({ token, name: user.name });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET PROFILE ──
router.get('/profile', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.upi_id, u.created_at,
              a.account_number, a.balance
       FROM users u
       JOIN accounts a ON u.id = a.user_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'User not found' });

    const u = result.rows[0];
    res.json({
      name: u.name,
      email: u.email,
      upi_id: u.upi_id,
      account_number: u.account_number,
      balance: u.balance,
      member_since: u.created_at
    });
  } catch (err) {
    console.error('Profile error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ADD MONEY (PIN required) ──
router.post('/add-money', auth, async (req, res) => {
  try {
    const { amount, pin } = req.body;
    const amt = parseFloat(amount);

    if (!pin) return res.status(400).json({ error: 'PIN is required' });
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Please enter a valid amount' });
    if (amt > 100000) return res.status(400).json({ error: 'Maximum ₹1,00,000 can be added at once' });

    const userResult = await pool.query('SELECT pin_hash FROM users WHERE id=$1', [req.user.id]);
    if (!userResult.rows.length)
      return res.status(404).json({ error: 'User not found' });

    const pinValid = await bcrypt.compare(String(pin), userResult.rows[0].pin_hash);
    if (!pinValid)
      return res.status(401).json({ error: 'Incorrect PIN. Money not added.' });

    await pool.query('UPDATE accounts SET balance = balance + $1 WHERE user_id=$2', [amt, req.user.id]);
    await pool.query(
      'INSERT INTO transactions (from_user_id, to_user_id, amount, type) VALUES ($1,$1,$2,$3)',
      [req.user.id, amt, 'deposit']
    );

    const updated = await pool.query('SELECT balance FROM accounts WHERE user_id=$1', [req.user.id]);
    res.json({
      message: `₹${parseFloat(amt).toLocaleString('en-IN')} added successfully!`,
      newBalance: updated.rows[0].balance
    });
  } catch (err) {
    console.error('Add money error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;