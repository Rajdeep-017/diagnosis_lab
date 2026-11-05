import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Card, StatusChip, Table, ThemeSwitcher } from '../components/UI';
import { useTheme, type Language } from '../theme';

export type Result = {
  id: number | string;
  name: string;
  value: number;
  displayValue: string;
  unit: string;
  low: number;
  high: number;
  displayRange: string;
  status: 'normal' | 'low' | 'high' | 'critical';
  summary?: string | null;
  summaries?: Partial<Record<Language, string>>;
  summaryId?: number | null;
  flagged?: boolean;
  trend?: number[];
};

export type ReportData = {
  order: { id: string; patient: string; date: string };
  results: Result[];
  language: Language;
};

export type ReportLayout = 'focus' | 'large' | 'compact';

function RangeBar({ result }: { result: Result }) {
  const extent = Math.max(result.high - result.low, Math.abs(result.value - result.low), Math.abs(result.value - result.high));
  const min = result.low - extent * 0.6;
  const max = result.high + extent * 0.6;
  const toX = (value: number) => Math.max(12, Math.min(288, 12 + ((value - min) / (max - min)) * 276));
  const ariaText = `${result.displayValue} ${result.unit}, ${result.status === 'low' ? 'below' : result.status === 'high' ? 'above' : 'within'} the normal range ${result.displayRange.replace(` ${result.unit}`, '')}`;
  return <svg className="range-bar" viewBox="0 0 300 44" role="img" aria-label={ariaText}>
    <rect x="12" y="18" width="276" height="10" rx="5" className="range-track" />
    <rect x={toX(result.low)} y="18" width={toX(result.high) - toX(result.low)} height="10" rx="5" className="range-normal" />
    <line x1={toX(result.low)} x2={toX(result.low)} y1="13" y2="33" className="range-tick" />
    <line x1={toX(result.high)} x2={toX(result.high)} y1="13" y2="33" className="range-tick" />
    <circle cx={toX(result.value)} cy="23" r="8" className={`range-marker range-marker--${result.status}`} />
  </svg>;
}

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values.map((value, index) => `${index * 40},${24 - ((value - min) / (max - min || 1)) * 18}`).join(' ');
  return <svg viewBox="0 0 80 28" className="sparkline" role="img" aria-label={`Trend over ${values.length} tests`}>
    <polyline points={points} fill="none" className="sparkline__line" />
  </svg>;
}

function SummaryCard({ result, language, onReportProblem, onOpenProblem }: {
  result: Result;
  language: Language;
  onReportProblem?: (summaryId: number, reason?: string) => Promise<void>;
  onOpenProblem?: (summaryId: number) => void;
}) {
  const summary = result.summaries?.[language] ?? result.summary ?? 'See full report.';
  return <Card className={`result-card result-card--${result.status}`}>
    <div className="result-card__heading"><div><p className="eyebrow">Test result</p><h2>{result.name}</h2></div><StatusChip status={result.status}>{result.status === 'normal' ? 'In range' : result.status === 'critical' ? 'Contact the lab' : result.status === 'low' ? 'Below range' : 'Above range'}</StatusChip></div>
    {result.status === 'critical' ? <div className="critical-note"><strong>Please contact the lab.</strong><p>A member of the lab team can explain this result and advise on next steps.</p></div> : <>
      <p className="result-value"><strong>{result.displayValue}</strong> <span>{result.unit}</span></p>
      <RangeBar result={result} />
      <p className="range-caption">{result.displayRange}</p>
      <p className="summary-text">{summary}</p>
      {result.summaryId && onReportProblem && onOpenProblem && <Button variant="secondary" onClick={() => onOpenProblem(result.summaryId!)}>{result.flagged ? 'Problem reported' : 'Report a problem with this summary'}</Button>}
    </>}
  </Card>;
}

function ProblemSheet({ summaryId, onClose, onSubmit }: {
  summaryId: number;
  onClose: () => void;
  onSubmit: (summaryId: number, reason?: string) => Promise<void>;
}) {
  const [sent, setSent] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await onSubmit(summaryId, reason.trim() || undefined);
      setSent(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not send your feedback. Please try again.');
    } finally {
      setPending(false);
    }
  }
  return <div className="sheet-backdrop" role="presentation" onClick={onClose}>
    <section className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="problem-title" onClick={(event) => event.stopPropagation()}>
      <button className="sheet-close" aria-label="Close" onClick={onClose}>×</button>
      <h2 id="problem-title">Report a problem with this summary</h2>
      {sent ? <p role="status">Thank you. The lab team will review your feedback.</p> : <form onSubmit={submit}>
        <p>Your feedback helps us improve these explanations. It will not change your test results.</p>
        <label className="field"><span className="field__label">What seems wrong? (optional)</span><textarea className="control" rows={3} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby="problem-reason-count" /></label>
        <p id="problem-reason-count" className="field__hint">{reason.length}/300 characters</p>
        {error && <p className="field__error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={pending}>{pending ? 'Sending…' : 'Send feedback'}</Button>
      </form>}
    </section>
  </div>;
}

export function ReportView({ layout = 'focus', report, onDownload, onReportProblem, notice }: {
  layout?: ReportLayout;
  report: ReportData;
  onDownload?: () => void;
  onReportProblem?: (summaryId: number, reason?: string) => Promise<void>;
  notice?: string;
}) {
  const { language, setLanguage, theme, setTheme } = useTheme();
  const activeReport = report;
  const [showNormal, setShowNormal] = useState(false);
  const [problemSummaryId, setProblemSummaryId] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [isOffline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const updateNetwork = () => setOffline(!navigator.onLine);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
  }, []);
  const sortedResults = useMemo(() => activeReport.results, [activeReport.results]);
  const critical = sortedResults.filter((item) => item.status === 'critical');
  const abnormal = sortedResults.filter((item) => item.status === 'low' || item.status === 'high' || item.status === 'critical');
  const normal = sortedResults.filter((item) => item.status === 'normal');
  const canReadAloud = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

  const download = () => {
    if (onDownload) {
      onDownload();
      return;
    }
    setToast('Use your browser print dialog to save this report as a PDF.');
    window.setTimeout(() => window.print(), 100);
  };
  const readAloud = () => {
    if (!canReadAloud) return;
    const utterance = new SpeechSynthesisUtterance(`${activeReport.order.patient}. ${abnormal.map((item) => `${item.name}: ${item.summaries?.[language] ?? item.summary ?? 'See full report.'}`).join('. ')}`);
    utterance.lang = language === 'te' ? 'te-IN' : language === 'hi' ? 'hi-IN' : 'en-IN';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };
  const reportRows = sortedResults.map((item) => [
    item.name,
    <StatusChip status={item.status}>{item.status === 'normal' ? 'In range' : item.status === 'critical' ? 'Contact the lab' : item.status === 'low' ? 'Below range' : 'Above range'}</StatusChip>,
    item.status === 'critical' ? 'Not shown' : item.displayValue + ' ' + item.unit,
    item.status === 'critical' ? 'Contact the lab' : item.displayRange,
    item.trend ? <Sparkline values={item.trend} /> : '—',
  ]);

  return <main className={`patient-shell report-layout--${layout}`}>
    {isOffline && <div className="offline-banner" role="status"><span>You're offline. Connect to refresh this report.</span><Button onClick={() => window.location.reload()}>Retry</Button></div>}
    <header className="report-header">
      <a className="brand" href="/">Company A <span>Reports</span></a>
      <div className="language-control" role="group" aria-label="Report language">
        {(['en', 'te', 'hi'] as const).map((value) => <button key={value} aria-pressed={language === value} onClick={() => setLanguage(value)}>{value.toUpperCase()}</button>)}
      </div>
      <ThemeSwitcher theme={theme} onChange={(value) => setTheme(value)} />
    </header>
    <section className="report-intro">
      <p className="eyebrow">Your report · {activeReport.order.id}</p>
      <h1>{activeReport.order.patient}</h1>
      <p className="report-date">Test date: {activeReport.order.date}</p>
      {critical.length > 0 && <Card className="critical-banner"><StatusChip status="critical">Contact the lab</StatusChip><p>Please contact the lab team to discuss your result. The report does not show critical values here.</p></Card>}
    </section>

    {layout === 'compact' ? <section className="compact-results"><h2>All test results</h2><Table headers={['Parameter', 'Flag', 'Your value', 'Reference range', 'Trend']} rows={reportRows} /></section> :
      <section className="results-section">
        <h2>{abnormal.length ? 'Results to review' : 'Your results'}</h2>
        {(layout === 'large' ? sortedResults.filter((item) => item.status !== 'critical') : abnormal.filter((item) => item.status !== 'critical')).map((item) => <SummaryCard key={item.id} result={item} language={language} onReportProblem={onReportProblem} onOpenProblem={setProblemSummaryId} />)}
        {layout === 'large' && canReadAloud && <Button className="read-aloud" onClick={readAloud}>▶ Read aloud</Button>}
        {abnormal.length === 0 && <p>All shown results are within their usual ranges.</p>}
        {normal.length > 0 && <div className="normal-results">
          <button className="disclosure" aria-expanded={showNormal} onClick={() => setShowNormal(!showNormal)}><span>{showNormal ? '−' : '+'} All other results ({normal.length})</span><span>{showNormal ? 'Hide' : 'Show'}</span></button>
          {showNormal && normal.map((item) => <SummaryCard key={item.id} result={item} language={language} onReportProblem={onReportProblem} onOpenProblem={setProblemSummaryId} />)}
        </div>}
      </section>}

    <div className="report-actions">
      {notice && <p className="field__error" role="alert">{notice}</p>}
      <Button className="desktop-download" variant="primary" onClick={download}>Download PDF</Button>
    </div>
    <footer className="report-footer"><p>Questions about your report? Contact the lab that collected your sample.</p></footer>
    <div className="sticky-actions"><Button variant="primary" onClick={download}>Download PDF</Button></div>
    {problemSummaryId !== null && onReportProblem && <ProblemSheet summaryId={problemSummaryId} onClose={() => setProblemSummaryId(null)} onSubmit={onReportProblem} />}
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}>×</button></div>}
  </main>;
}
