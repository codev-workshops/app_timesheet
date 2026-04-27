'use client';

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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Card,
  CardContent,
  Grid,
  Alert,
  CircularProgress,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  PictureAsPdf as PdfIcon,
  Description as CsvIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { type ClientReport } from '@/lib/types';

export default function ReportsPage() {
  const [selectedClientId, setSelectedClientId] = useState<number>(0);
  const [error, setError] = useState('');

  const { data: clientsData, isLoading: clientsLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiClient.getClients(),
  });

  const { data: reportData, isLoading: reportLoading } = useQuery({
    queryKey: ['clientReport', selectedClientId],
    queryFn: () => apiClient.getClientReport(selectedClientId),
    enabled: selectedClientId > 0,
  });

  const clients = (clientsData?.clients || []) as unknown as Array<{ id: number; name: string }>;
  const report = reportData as ClientReport | undefined;

  const handleExportCsv = async () => {
    if (!selectedClientId) return;

    try {
      const blob = await apiClient.exportClientReportCsv(selectedClientId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const client = clients.find((c) => c.id === selectedClientId);
      a.download = `${client?.name?.replace(/[^a-zA-Z0-9]/g, '_')}_report_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      setError('Failed to export CSV report');
      console.error('Export error:', err);
    }
  };

  const handleExportPdf = async () => {
    if (!selectedClientId) return;

    try {
      const blob = await apiClient.exportClientReportPdf(selectedClientId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const client = clients.find((c) => c.id === selectedClientId);
      a.download = `${client?.name?.replace(/[^a-zA-Z0-9]/g, '_')}_report_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      setError('Failed to export PDF report');
      console.error('Export error:', err);
    }
  };

  if (clientsLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Reports
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {clients.length === 0 ? (
        <Paper sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            You need to create at least one client before generating reports.
          </Typography>
          <Button variant="contained" href="/clients">
            Create Client
          </Button>
        </Paper>
      ) : (
        <>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Grid container spacing={3} alignItems="center">
              <Grid size={{ xs: 12, md: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>Select Client</InputLabel>
                  <Select
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(Number(e.target.value))}
                    label="Select Client"
                  >
                    <MenuItem value={0}>Choose a client...</MenuItem>
                    {clients.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Box display="flex" gap={2}>
                  <Tooltip title="Export as CSV">
                    <IconButton
                      onClick={handleExportCsv}
                      disabled={!selectedClientId || reportLoading}
                      color="primary"
                      size="large"
                    >
                      <CsvIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Export as PDF">
                    <IconButton
                      onClick={handleExportPdf}
                      disabled={!selectedClientId || reportLoading}
                      color="error"
                      size="large"
                    >
                      <PdfIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Grid>
            </Grid>
          </Paper>

          {selectedClientId > 0 && reportLoading && (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
              <CircularProgress />
            </Box>
          )}

          {selectedClientId > 0 && report && (
            <>
              <Grid container spacing={3} sx={{ mb: 3 }}>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card>
                    <CardContent>
                      <Typography color="textSecondary" gutterBottom>
                        Total Hours
                      </Typography>
                      <Typography variant="h4" component="div">
                        {report.totalHours.toFixed(2)}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card>
                    <CardContent>
                      <Typography color="textSecondary" gutterBottom>
                        Total Entries
                      </Typography>
                      <Typography variant="h4" component="div">
                        {report.entryCount}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card>
                    <CardContent>
                      <Typography color="textSecondary" gutterBottom>
                        Average Hours per Entry
                      </Typography>
                      <Typography variant="h4" component="div">
                        {report.entryCount > 0
                          ? (report.totalHours / report.entryCount).toFixed(2)
                          : '0.00'}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>

              <Paper>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Hours</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell>Created</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.workEntries.length > 0 ? (
                        report.workEntries.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell>
                              <Typography variant="body2">
                                {new Date(entry.date).toLocaleDateString()}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={`${entry.hours} hours`}
                                color="primary"
                                variant="outlined"
                              />
                            </TableCell>
                            <TableCell>
                              {entry.description ? (
                                <Typography variant="body2" color="text.secondary">
                                  {entry.description}
                                </Typography>
                              ) : (
                                <Chip label="No description" size="small" variant="outlined" />
                              )}
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" color="text.secondary">
                                {new Date(entry.created_at).toLocaleDateString()}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={4} align="center">
                            <Typography color="text.secondary" sx={{ py: 3 }}>
                              No work entries found for this client.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </>
          )}

          {!selectedClientId && (
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">
                Select a client to view their time report.
              </Typography>
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
