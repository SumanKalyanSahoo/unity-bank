const router = require('express').Router();
const auth = require('../middleware/auth');
const pool = require('../db');

// ── DASHBOARD ──
router.get('/dashboard', auth, async (req, res) => {
  try {
    const me = await pool.query(
      `SELECT 
         u.name, 
         u.email, 
         u.upi_id, 
         a.balance, 
         a.account_number
       FROM users u 
       INNER JOIN accounts a ON u.id = a.user_id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (!me.rows.length) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Debug log — remove after confirming it works
    console.log('Dashboard data:', me.rows[0]);

    const others = await pool.query(
      `SELECT 
         u.name, 
         u.email, 
         u.upi_id, 
         a.balance
       FROM users u 
       INNER JOIN accounts a ON u.id = a.user_id
       WHERE u.id != $1 
       ORDER BY u.name ASC`,
      [req.user.id]
    );

    res.json({
      me: {
        name: me.rows[0].name,
        email: me.rows[0].email,
        upi_id: me.rows[0].upi_id,
        balance: me.rows[0].balance,
        account_number: me.rows[0].account_number
      },
      customers: others.rows
    });

  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;