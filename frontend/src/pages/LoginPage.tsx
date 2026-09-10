import React, { useState } from 'react';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Alert,
  CircularProgress,
} from '@mui/material';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';

/**
 * Email-only sign-in screen.
 *
 * @remarks
 * The form has a single field on purpose: the backend authenticates purely on
 * the trust-based `x-user-email` header, so collecting a password would be
 * misleading. The info `Alert` makes that explicit to users.
 *
 * Loading and error state are kept local rather than in `AuthProvider` because
 * only this screen needs them; the provider stays focused on identity. Errors
 * prefer the server's `{ error }` message (Joi validation, e.g. malformed
 * email) and fall back to a generic string for network failures.
 *
 * @returns The login form; navigates to `/dashboard` on success.
 */
const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  /**
   * Submits the email to `AuthProvider.login`.
   *
   * @param e - Form submit event; default is prevented to avoid a page reload,
   * which would wipe React state before the request finished.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(email);
      navigate('/dashboard');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Container component="main" maxWidth="sm">
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        px: 2,
      }}
    >
      <Paper elevation={3} sx={{ padding: 3, width: '100%', maxWidth: 500 }}>
        <Typography component="h1" variant="h4" align="center" gutterBottom>
          Time Tracker
        </Typography>
        <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 2 }}>
          Enter your email to log in
        </Typography>
        <Alert severity="info" sx={{ mb: 2 }}>
          This app intentionally does not have a password field.
        </Alert>
        
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box component="form" onSubmit={handleSubmit}>
          <TextField
            margin="normal"
            required
            fullWidth
            id="email"
            label="Email Address"
            name="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
          />
          <Button
            type="submit"
            fullWidth
            variant="contained"
            sx={{ mt: 2, mb: 1 }}
            disabled={isLoading || !email}
          >
            {isLoading ? <CircularProgress size={24} /> : 'Log In'}
          </Button>
        </Box>
      </Paper>
    </Box>
    </Container>
  );
};

export default LoginPage;
