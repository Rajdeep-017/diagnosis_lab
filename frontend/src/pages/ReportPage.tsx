import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorState, Skeleton } from '../components/UI';
import {
  downloadReportPdf,
  getPatientReport,
  PatientApiError,
  type PatientReport,
  reportSummaryProblem,
} from '../api/patient';
import { useTheme } from '../theme';
import { ReportView, type ReportData, type Result } from './ReportView';

function displayDate(value: string | null) {
  if (!value) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(value));
}

function convertReport(data: PatientReport): ReportData {
  const results: Result[] = data.results.map((item) => {
    const bounds = item.reference_range?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const low = bounds[0] ?? 0;
    const high = bounds[1] ?? low + 1;
    const value = item.value === null ? 0 : Number(item.value);
    return {
      id: item.id,
      name: item.name,
      value: Number.isFinite(value) ? value : 0,
      displayValue: item.value ?? '',
      unit: item.unit ?? '',
      low,
      high,
      displayRange: item.reference_range
        ? `${item.reference_range}${item.unit ? ` ${item.unit}` : ''}`
        : 'Reference range unavailable',
      status: item.flag,
      summary: item.summary,
      summaryId: item.summary_id,
      flagged: item.flagged,
    };
  });
  return {
    order: {
      id: data.order.order_no,
      patient: data.order.patient,
      date: displayDate(data.order.signed_at),
    },
    language: data.language,
    results,
  };
}

export default function ReportPage({ orderId }: { orderId: number }) {
  const { language } = useTheme();
  const queryClient = useQueryClient();
  const [downloadError, setDownloadError] = useState('');
  const report = useQuery({
    queryKey: ['patient', 'report', orderId, language],
    queryFn: () => getPatientReport(orderId, language),
    retry: (failureCount, error) => error instanceof PatientApiError && error.kind === 'network' && failureCount < 2,
  });
  const flagMutation = useMutation({
    mutationFn: ({ summaryId, reason }: { summaryId: number; reason?: string }) => reportSummaryProblem(summaryId, reason),
    onMutate: async ({ summaryId }) => {
      const queryKey = ['patient', 'report', orderId, language] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<PatientReport>(queryKey);
      if (previous) {
        queryClient.setQueryData<PatientReport>(queryKey, {
          ...previous,
          results: previous.results.map((item) => item.summary_id === summaryId ? { ...item, flagged: true } : item),
        });
      }
      return { previous, queryKey };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['patient', 'report', orderId] }),
  });

  useEffect(() => {
    if (report.error instanceof PatientApiError && report.error.kind === 'unauthorized') {
      window.location.assign('/login');
    }
  }, [report.error]);

  async function download() {
    setDownloadError('');
    try {
      const blob = await downloadReportPdf(orderId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `lab-report-${orderId}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (error instanceof PatientApiError && error.kind === 'unauthorized') {
        window.location.assign('/login');
        return;
      }
      setDownloadError(error instanceof Error ? error.message : 'Could not download the report.');
    }
  }

  if (report.isPending) {
    return <main className="patient-shell"><Skeleton className="skeleton--large" /></main>;
  }
  if (report.isError) {
    if (report.error instanceof PatientApiError && report.error.kind === 'unauthorized') return null;
    if (report.error instanceof PatientApiError && report.error.kind === 'expired') {
      return <main className="patient-shell"><Card><h1>Report access expired</h1><p>Verify your mobile number to get access again.</p><Button variant="primary" onClick={() => window.location.assign('/login')}>Get a new link with OTP</Button></Card></main>;
    }
    return <main className="patient-shell"><ErrorState title={report.error.message || 'Could not load this report.'} onRetry={() => void report.refetch()} /></main>;
  }

  return <ReportView
    report={convertReport(report.data)}
    onDownload={() => void download()}
    onReportProblem={(summaryId, reason) => flagMutation.mutateAsync({ summaryId, reason }).then(() => undefined)}
    notice={downloadError}
  />;
}
