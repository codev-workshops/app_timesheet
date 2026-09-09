import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  Chip,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  DeleteSweep as DeleteSweepIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';
import { type Client } from '../types/api';

/**
 * Client management: table of the user's clients plus create/edit/delete.
 *
 * All rows come from the authenticated user's own data — scoping happens
 * server-side from the email header — so nothing here filters by owner.
 *
 * @returns The clients page.
 */
const ClientsPage: React.FC = () => {
  const [open, setOpen] = useState(false);
  // A single dialog serves both create and edit; `editingClient` is the mode
  // switch (null = create) and drives the title and which mutation runs.
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  // Form fields are held as empty strings rather than `null`/`undefined`
  // because MUI text fields must stay controlled; they are converted back to
  // `undefined` on submit so blanks are not sent as empty values.
  const [formData, setFormData] = useState({ name: '', description: '', department: '', email: '' });
  // One shared error slot for the query dialog and all four mutations — only
  // one operation is in flight at a time, so a single banner suffices.
  const [error, setError] = useState('');

  const queryClient = useQueryClient();

  const { data: clientsData, isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiClient.getClients(),
  });

  // Each mutation invalidates the `clients` key rather than patching the cache:
  // the server assigns ids and timestamps, so refetching is the only way to
  // show the authoritative row (and it also refreshes the dashboard's counts).
  // Closing the dialog in `onSuccess` keeps it open on failure so the user's
  // input is not lost.
  const createMutation = useMutation({
    mutationFn: (clientData: { name: string; description?: string; department?: string; email?: string }) =>
      apiClient.createClient(clientData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      handleClose();
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Failed to create client');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; description?: string; department?: string; email?: string } }) =>
      apiClient.updateClient(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      handleClose();
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Failed to update client');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.deleteClient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Failed to delete client');
    },
  });

  // Bulk delete of every client owned by the user; the destructive-action
  // confirmation lives in `handleDeleteAll`, not here.
  const deleteAllMutation = useMutation({
    mutationFn: () => apiClient.deleteAllClients(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Failed to delete all clients');
    },
  });

  const clients = clientsData?.clients || [];

  /**
   * Opens the dialog for editing an existing client, or for creating one.
   *
   * Seeds the form from the client and coalesces its nullable columns to empty
   * strings so the inputs stay controlled. Any stale error is cleared so a
   * previous failure does not appear over a fresh form.
   *
   * @param client Client to edit; omit to create a new one.
   */
  const handleOpen = (client?: Client) => {
    if (client) {
      setEditingClient(client);
      setFormData({ 
        name: client.name, 
        description: client.description || '',
        department: client.department || '',
        email: client.email || ''
      });
    } else {
      setEditingClient(null);
      setFormData({ name: '', description: '', department: '', email: '' });
    }
    setError('');
    setOpen(true);
  };

  /**
   * Closes the dialog and resets it.
   *
   * Resetting on close (rather than on open) means a cancelled edit cannot leak
   * its values into the next create.
   */
  const handleClose = () => {
    setOpen(false);
    setEditingClient(null);
    setFormData({ name: '', description: '', department: '', email: '' });
    setError('');
  };

  /**
   * Validates the form and routes it to the create or update mutation.
   *
   * The name check duplicates the backend's Joi rule deliberately, to give
   * immediate feedback and avoid a pointless round trip. Blank optional fields
   * are converted to `undefined` so they are omitted from the request body:
   * sending `''` would store an empty string instead of leaving the column
   * unset.
   *
   * @param e Form submit event.
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.name.trim()) {
      setError('Client name is required');
      return;
    }

    if (editingClient) {
      updateMutation.mutate({
        id: editingClient.id,
        data: {
          name: formData.name,
          description: formData.description || undefined,
          department: formData.department || undefined,
          email: formData.email || undefined,
        },
      });
    } else {
      createMutation.mutate({
        name: formData.name,
        description: formData.description || undefined,
        department: formData.department || undefined,
        email: formData.email || undefined,
      });
    }
  };

  /**
   * Deletes one client after confirmation.
   *
   * @param client Client to delete; its name is echoed in the prompt so the
   *   user can see which row they clicked.
   */
  const handleDelete = (client: Client) => {
    if (window.confirm(`Are you sure you want to delete "${client.name}"?`)) {
      deleteMutation.mutate(client.id);
    }
  };

  /**
   * Deletes every client after confirmation.
   *
   * The prompt is the only safeguard: the backend performs the delete
   * immediately and its database is in-memory, so there is no recovery path.
   */
  const handleDeleteAll = () => {
    if (window.confirm('Are you sure you want to delete ALL clients? This action cannot be undone.')) {
      deleteAllMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Clients</Typography>
        <Box display="flex" gap={2}>
          {clients.length > 0 && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteSweepIcon />}
              onClick={handleDeleteAll}
              disabled={deleteAllMutation.isPending}
            >
              {deleteAllMutation.isPending ? 'Clearing...' : 'Clear All'}
            </Button>
          )}
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>
            Add Client
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {clients.length > 0 ? (
                clients.map((client: Client) => (
                  <TableRow key={client.id}>
                    <TableCell>
                      <Typography variant="subtitle1" fontWeight="medium">
                        {client.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {client.department ? (
                        <Typography variant="body2" color="text.secondary">
                          {client.department}
                        </Typography>
                      ) : (
                        <Chip label="-" size="small" variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell>
                      {client.email ? (
                        <Typography variant="body2" color="text.secondary">
                          {client.email}
                        </Typography>
                      ) : (
                        <Chip label="-" size="small" variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell>
                      {client.description ? (
                        <Typography variant="body2" color="text.secondary">
                          {client.description}
                        </Typography>
                      ) : (
                        <Chip label="No description" size="small" variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {new Date(client.created_at).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        onClick={() => handleOpen(client)}
                        color="primary"
                        size="small"
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        onClick={() => handleDelete(client)}
                        color="error"
                        size="small"
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography color="text.secondary" sx={{ py: 3 }}>
                      No clients found. Create your first client to get started.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingClient ? 'Edit Client' : 'Add New Client'}
        </DialogTitle>
        <form onSubmit={handleSubmit}>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="Client Name"
              fullWidth
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={createMutation.isPending || updateMutation.isPending}
            />
            <TextField
              margin="dense"
              label="Department"
              fullWidth
              value={formData.department}
              onChange={(e) => setFormData({ ...formData, department: e.target.value })}
              disabled={createMutation.isPending || updateMutation.isPending}
            />
            <TextField
              margin="dense"
              label="Email"
              fullWidth
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              disabled={createMutation.isPending || updateMutation.isPending}
            />
            <TextField
              margin="dense"
              label="Description"
              fullWidth
              multiline
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              disabled={createMutation.isPending || updateMutation.isPending}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose} disabled={createMutation.isPending || updateMutation.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <CircularProgress size={24} />
              ) : (
                editingClient ? 'Update' : 'Create'
              )}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default ClientsPage;
