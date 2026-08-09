const app = require('./app');
const { initializeDatabase } = require('./database/init');
const { isSqsReportsBackend } = require('./reports/backend');

const PORT = process.env.PORT || 3001;

// Initialize database and start server
async function startServer() {
  try {
    await initializeDatabase();
    if (isSqsReportsBackend()) {
      await require('./reports/queue').initializeReportQueue();
    }
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
