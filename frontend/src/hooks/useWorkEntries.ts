import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';
import type { WorkEntryListParams } from '../types/api';

export const workEntryKeys = {
  all: ['workEntries'] as const,
  list: (params: WorkEntryListParams) => ['workEntries', 'list', params] as const,
  summary: ['workEntries', 'summary'] as const,
};

export const useWorkEntries = (params: WorkEntryListParams = {}) =>
  useQuery({
    queryKey: workEntryKeys.list(params),
    queryFn: () => apiClient.getWorkEntries(params),
    placeholderData: (previous) => previous,
  });

export const useWorkEntrySummary = () =>
  useQuery({
    queryKey: workEntryKeys.summary,
    queryFn: () => apiClient.getWorkEntrySummary(),
  });

// Invalidates every work-entry query (all pages and the summary).
export const useInvalidateWorkEntries = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: workEntryKeys.all });
};
