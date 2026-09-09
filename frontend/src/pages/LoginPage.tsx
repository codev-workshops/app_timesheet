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
 * Email-only login screen.
 *
 * There is no password field by design — the backend authenticates requests
 * from an `x-user-email` header, so submitting an address is the whole flow —
 * and the info alert says so to pre-empt "the form is broken" reports. Any
 * unknown address is created on submit, so this is also the sign-up screen.
 *
 * Loading and error state are local `useState` rather than TanStack Query
 * because logging in mutates auth context (not server state the cache tracks)
 * and the redirect happens immediately afterwards.
 *
 * @returns The login form.
 */
const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  /**
   * Submits the email and, on success, sends the user to the dashboard.
   *
   * `preventDefault` keeps the browser from doing a real form POST. The error
   * message prefers the backend's `error` field (e.g. a rejected email format)
   * and falls back to generic copy for network failures, which carry no
   * response body. `finally` clears the loading flag so a failed attempt
   * re-enables the form rather than leaving the spinner stuck.
   *
   * @param e Form submit event.
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
