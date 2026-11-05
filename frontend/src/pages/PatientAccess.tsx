import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, EmptyState, ErrorState, Input, Skeleton, StatusChip } from '../components/UI';
import {
  getDemoOtp,
  getPatientSession,
  getPatientReport,
  listPatientOrders,
  requestOtp,
  PatientApiError,
  validateReportLink,
  verifyOtp,
  type PatientOrder,
} from '../api/patient';
import { useTheme } from '../theme';

function go(path: string) {
  window.location.assign(path);
}

function retrySeconds(error: unknown) {
  return error instanceof PatientApiError && error.kind === 'rate_limited'
    ? Math.max(error.retryAfter ?? 0, 0)
    : 0;
}

function useRetryCountdown(seconds: number) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => setRemaining(seconds), [seconds]);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setRemaining((value) => Math.max(value - 1, 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);
  return remaining;
}

function PatientHeader() {
  return <header className="report-header"><a className="brand" href="/">Company A <span>Reports</span></a><a href="/login">Sign in</a></header>;
}

export function ReportLinkPage({ token }: { token: string }) {
  const validation = useQuery({
    queryKey: ['patient', 'link', token],
    queryFn: () => validateReportLink(token),
    retry: false,
  });
  useEffect(() => {
    if (validation.data) go(`/login?link_token=${encodeURIComponent(token)}`);
  }, [token, validation.data]);
  if (validation.isPending || validation.data) return <main className="patient-shell"><Skeleton className="skeleton--large" /></main>;
  if (validation.error instanceof PatientApiError && validation.error.kind === 'expired') {
    return <main className="patient-shell"><PatientHeader /><Card><p className="eyebrow">Secure report access</p><h1>This link has expired</h1><p>Verify the mobile number for this report to get a new link.</p><Button variant="primary" onClick={() => go(`/login?link_token=${encodeURIComponent(token)}`)}>Get a new link with OTP</Button></Card></main>;
  }
  if (validation.isError) {
    return <main className="patient-shell"><PatientHeader /><ErrorState title={validation.error.message || 'Could not validate this link.'} onRetry={() => void validation.refetch()} /></main>;
  }
  return null;
}

export function PatientLoginPage() {
  const linkToken = new URLSearchParams(window.location.search).get('link_token') ?? undefined;
  const [mobile, setMobile] = useState('');
  const [consent, setConsent] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useMutation({
    mutationFn: () => requestOtp({
      mobile,
      consent,
      consent_version: 'dpdp-v1',
      ...(linkToken ? { link_token: linkToken } : {}),
    }),
    onSuccess: ({ challenge_id, demo_mode }) => go(`/verify?challenge_id=${encodeURIComponent(challenge_id)}${demo_mode ? '&demo=1' : ''}`),
    onError: (error) => setRetry(retrySeconds(error)),
  });
  const retryRemaining = useRetryCountdown(retry);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    request.mutate();
  }

  return <main className="patient-shell">
    <PatientHeader />
    <Card className="patient-auth-card">
      <p className="eyebrow">Secure patient access</p>
      <h1>Sign in with your mobile</h1>
      <p>We will send a one-time code to verify your access to lab reports.</p>
      <form className="patient-auth-form" onSubmit={submit}>
        <Input label="Mobile number" name="mobile" type="tel" inputMode="tel" autoComplete="tel" required value={mobile} onChange={(event) => setMobile(event.target.value)} />
        <label className="consent-control"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>I agree to receive a one-time verification code for secure report access.</span></label>
        {request.error && <p className="field__error" role="alert">{request.error.message}{retryRemaining > 0 ? ` Try again in ${retryRemaining} seconds.` : ''}</p>}
        <Button type="submit" variant="primary" disabled={request.isPending || retryRemaining > 0}>{request.isPending ? 'Sending code…' : retryRemaining > 0 ? `Try again in ${retryRemaining}s` : 'Send verification code'}</Button>
      </form>
    </Card>
  </main>;
}

export function PatientVerifyPage() {
  const search = new URLSearchParams(window.location.search);
  const challengeId = search.get('challenge_id') ?? '';
  const demoMode = search.get('demo') === '1' || import.meta.env.VITE_DEMO_MODE === 'true';
  const [code, setCode] = useState('');
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const verified = useMutation({
    mutationFn: () => verifyOtp(challengeId, code),
    onSuccess: ({ renewed_link_url, next_order_id }) => {
      if (renewed_link_url) {
        setRenewedLink(renewed_link_url);
      } else if (next_order_id) {
        go('/patients');
      } else {
        go('/patients');
      }
    },
    onError: (error) => {
      if (error instanceof PatientApiError) {
        if (error.code === 'invalid_otp') setAttemptsRemaining(error.attemptsRemaining ?? null);
        if (error.kind === 'rate_limited') setRetry(retrySeconds(error));
      }
    },
  });
  const [renewedLink, setRenewedLink] = useState('');
  const retryRemaining = useRetryCountdown(retry);
  const demo = useQuery({
    queryKey: ['patient', 'demo-otp', challengeId],
    queryFn: () => getDemoOtp(challengeId),
    enabled: Boolean(challengeId) && demoMode,
    retry: false,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    verified.mutate();
  }

  if (!challengeId) return <main className="patient-shell"><Card><h1>Verification session not found</h1><Button onClick={() => go('/login')}>Request a new code</Button></Card></main>;
  if (renewedLink) return <main className="patient-shell"><PatientHeader /><Card><p className="eyebrow">Mobile verified</p><h1>Your new report link is ready</h1><p><a href={renewedLink}>Open your renewed report link</a></p><Button variant="primary" onClick={() => go('/patients')}>View your reports</Button></Card></main>;

  return <main className="patient-shell">
    <PatientHeader />
    <Card className="patient-auth-card">
      <p className="eyebrow">One-time verification</p>
      <h1>Enter your code</h1>
      <p>Enter the six-digit code sent to your mobile number.</p>
      {demo.data && <div className="demo-otp-banner" role="status"><strong>Demo code</strong><span>For review only: {demo.data.code}</span></div>}
      {demo.isError && <p role="alert">Demo code could not be loaded. Check the backend demo outbox and try again.</p>}
      <form className="patient-auth-form" onSubmit={submit}>
        <Input label="Verification code" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
        {verified.error && <p className="field__error" role="alert">{verified.error.message}{attemptsRemaining !== null ? ` ${attemptsRemaining} attempts remaining.` : ''}{retryRemaining > 0 ? ` Try again in ${retryRemaining} seconds.` : ''}</p>}
        <Button type="submit" variant="primary" disabled={verified.isPending || retryRemaining > 0}>{verified.isPending ? 'Verifying…' : 'Verify code'}</Button>
      </form>
    </Card>
  </main>;
}

export function PatientPickerPage() {
  const session = useQuery({
    queryKey: ['patient', 'session'],
    queryFn: getPatientSession,
    retry: (count, error) => error instanceof PatientApiError && error.kind === 'network' && count < 2,
  });
  useEffect(() => {
    if (session.error instanceof PatientApiError && session.error.kind === 'unauthorized') go('/login');
    if (session.data?.patients.length === 1) go(`/orders?patient_id=${session.data.patients[0].id}`);
  }, [session.data, session.error]);
  if (session.isPending || session.data?.patients.length === 1) return <main className="patient-shell"><Skeleton className="skeleton--large" /></main>;
  if (session.isError) {
    if (session.error instanceof PatientApiError && session.error.kind === 'unauthorized') return null;
    return <main className="patient-shell"><ErrorState title={session.error.message || 'Could not load family members.'} onRetry={() => void session.refetch()} /></main>;
  }
  return <main className="patient-shell"><PatientHeader /><section className="report-intro"><p className="eyebrow">Your account</p><h1>Choose a patient</h1><p className="lead">Select whose reports you want to view.</p></section>
    {session.data.patients.length === 0
      ? <EmptyState title="No linked patients yet">Ask the lab to link a patient record to your verified mobile number.</EmptyState>
      : <div className="patient-picker-list">{session.data.patients.map((patient) => <Card key={patient.id}><h2>{patient.name}</h2><Button variant="primary" onClick={() => go(`/orders?patient_id=${patient.id}`)}>View reports</Button></Card>)}</div>}
  </main>;
}

function OrderCard({ order, language }: { order: PatientOrder; language: 'en' | 'te' | 'hi' }) {
  const queryClient = useQueryClient();
  const prefetchReport = () => queryClient.prefetchQuery({
    queryKey: ['patient', 'report', order.id, language],
    queryFn: () => getPatientReport(order.id, language),
  });
  return <Card className="patient-order-card" onMouseEnter={() => void prefetchReport()} onFocus={() => void prefetchReport()}>
    <p className="eyebrow">{order.order_no}</p>
    <h2>Lab report</h2>
    <p>{order.signed_at ? `Signed ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(order.signed_at))}` : 'Not signed yet'}</p>
    <StatusChip status={order.status === 'ready' ? 'delivered' : order.status}>{order.status === 'ready' ? 'Ready to view' : order.status}</StatusChip>
    <Button className="order-action" variant="primary" onClick={() => go(`/report/${order.id}`)} disabled={order.status !== 'ready'}>{order.status === 'ready' ? 'Open report' : 'Report not ready'}</Button>
  </Card>;
}

export function PatientOrdersPage() {
  const { language } = useTheme();
  const patientIdText = new URLSearchParams(window.location.search).get('patient_id');
  const patientId = patientIdText && /^\d+$/.test(patientIdText) ? Number(patientIdText) : null;
  const session = useQuery({
    queryKey: ['patient', 'session'],
    queryFn: getPatientSession,
    retry: (count, error) => error instanceof PatientApiError && error.kind === 'network' && count < 2,
  });
  const orders = useQuery({
    queryKey: ['patient', 'orders', patientId],
    queryFn: () => listPatientOrders(patientId!),
    enabled: patientId !== null && Boolean(session.data),
    retry: (count, error) => error instanceof PatientApiError && error.kind === 'network' && count < 2,
  });
  useEffect(() => {
    if (session.error instanceof PatientApiError && session.error.kind === 'unauthorized') go('/login');
    if (session.data && !patientId) {
      if (session.data.patients.length === 1) go(`/orders?patient_id=${session.data.patients[0].id}`);
      else go('/patients');
    }
    if (orders.error instanceof PatientApiError && orders.error.kind === 'unauthorized') go('/login');
  }, [orders.error, patientId, session.data, session.error]);
  if (session.isError || orders.isError) {
    const error = session.error ?? orders.error;
    if (error instanceof PatientApiError && error.kind === 'unauthorized') return null;
    return <main className="patient-shell"><ErrorState title={error?.message || 'Could not load orders.'} onRetry={() => void (session.isError ? session.refetch() : orders.refetch())} /></main>;
  }
  if (session.isPending || (patientId !== null && orders.isPending) || !patientId) return <main className="patient-shell"><Skeleton className="skeleton--large" /></main>;
  if (!orders.data) return <main className="patient-shell"><Skeleton className="skeleton--large" /></main>;
  const currentPatient = session.data.patients.find((patient) => patient.id === patientId);
  return <main className="patient-shell">
    <PatientHeader />
    <section className="report-intro"><p className="eyebrow">Your reports</p><h1>{currentPatient?.name ?? 'Lab reports'}</h1>
      {session.data.patients.length > 1 && <Button onClick={() => go('/patients')}>Choose another patient</Button>}
    </section>
    {orders.data.orders.length === 0
      ? <EmptyState title="No reports yet">When a report is ready, it will appear here.</EmptyState>
      : <div className="patient-order-list">{orders.data.orders.map((order) => <OrderCard key={order.id} order={order} language={language} />)}</div>}
  </main>;
}
