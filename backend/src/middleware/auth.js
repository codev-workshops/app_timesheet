const { getDatabase } = require('../database/init');
const logger = require('../logger');
const { setRequestContext } = require('./requestContext');

// Simple email-based authentication middleware
function authenticateUser(req, res, next) {
  const userEmail = req.headers['x-user-email'];
  
  if (!userEmail) {
    return res.status(401).json({ error: 'User email required in x-user-email header' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(userEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const db = getDatabase();
  
  // Check if user exists, create if not
  db.get('SELECT email FROM users WHERE email = ?', [userEmail], (err, row) => {
    if (err) {
      logger.error('Database error', { err });
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    if (!row) {
      // Create new user
      db.run('INSERT INTO users (email) VALUES (?)', [userEmail], (err) => {
        if (err) {
          logger.error('Error creating user', { err });
          return res.status(500).json({ error: 'Failed to create user' });
        }
        
        req.userEmail = userEmail;
        setRequestContext({ userEmail });
        next();
      });
    } else {
      req.userEmail = userEmail;
      setRequestContext({ userEmail });
      next();
    }
  });
}

module.exports = {
  authenticateUser
};
