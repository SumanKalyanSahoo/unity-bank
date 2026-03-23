const router = require('express').Router();
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const pool = require('../db');

// ── SEND MONEY via UPI ID (PIN required) ──
router.post('/send', auth, async (req, res) => {
  try {
    const { upiId, amount, pin } = req.body;
    const amt = parseFloat(amount);

    if (!upiId || isNaN(amt) || amt <= 0)
      return res.status(400).json({ error: 'Please enter a valid UPI ID and amount' });

    if (amt > 100000)
      return res.status(400).json({ error: 'Amount exceeds the ₹1,00,000 limit' });

    if (!pin)
      return res.status(400).json({ error: 'PIN is required for transactions' });

    // Verify PIN
    const userResult = await pool.query('SELECT pin_hash FROM users WHERE id=$1', [req.user.id]);
    if (!userResult.rows.length)
      return res.status(404).json({ error: 'User not found' });

    const pinValid = await bcrypt.compare(String(pin), userResult.rows[0].pin_hash);
    if (!pinValid)
      return res.status(401).json({ error: 'Incorrect PIN. Transaction blocked.' });

    // Check sender balance
    const senderAcc = await pool.query('SELECT balance FROM accounts WHERE user_id=$1', [req.user.id]);
    if (!senderAcc.rows.length)
      return res.status(404).json({ error: 'Your account was not found' });

    if (parseFloat(senderAcc.rows[0].balance) < amt)
      return res.status(400).json({ error: 'Insufficient balance' });

    // Find recipient by UPI ID
    const recipient = await pool.query('SELECT id, name FROM users WHERE upi_id=$1', [upiId]);
    if (!recipient.rows.length)
      return res.status(404).json({ error: `No account found with UPI ID: ${upiId}` });

    const toId = recipient.rows[0].id;
    const toName = recipient.rows[0].name;

    if (toId === req.user.id)
      return res.status(400).json({ error: 'You cannot send money to yourself' });

    // Atomic transfer
    await pool.query('BEGIN');
    await pool.query('UPDATE accounts SET balance = balance - $1 WHERE user_id=$2', [amt, req.user.id]);
    await pool.query('UPDATE accounts SET balance = balance + $1 WHERE user_id=$2', [amt, toId]);
    await pool.query(
      'INSERT INTO transactions (from_user_id, to_user_id, amount, type) VALUES ($1,$2,$3,$4)',
      [req.user.id, toId, amt, 'transfer']
    );
    await pool.query('COMMIT');

    res.json({ message: `₹${parseFloat(amt).toLocaleString('en-IN')} sent to ${toName} successfully!` });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Transfer error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── LOOKUP UPI ID (to show name before sending) ──
router.get('/lookup/:upiId', auth, async (req, res) => {
  try {
    const { upiId } = req.params;
    const result = await pool.query('SELECT name, upi_id FROM users WHERE upi_id=$1', [upiId]);
    if (!result.rows.length)
      return res.status(404).json({ error: 'No account found with this UPI ID' });

    if (result.rows[0].id === req.user.id)
      return res.status(400).json({ error: 'This is your own UPI ID' });

    res.json({ name: result.rows[0].name, upi_id: result.rows[0].upi_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TRANSACTION HISTORY ──
router.get('/history', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.amount, t.type, t.created_at,
              s.name AS from_name, s.email AS from_email, s.upi_id AS from_upi,
              r.name AS to_name,   r.email AS to_email,   r.upi_id AS to_upi
       FROM transactions t
       JOIN users s ON t.from_user_id = s.id
       JOIN users r ON t.to_user_id   = r.id
       WHERE t.from_user_id=$1 OR t.to_user_id=$1
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('History error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;