import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, EmptyState, ErrorState, Input, Skeleton, StatusChip, ThemeSwitcher } from '../components/UI';
import {
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
  return <header className="report-header"><a className="brand" href="/">Company A <span>Reports</span></a></header>;
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
  const { language, setLanguage, theme, setTheme } = useTheme();
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
  const copy = {
    en: {
      eyebrow: 'Secure patient access',
      title: 'View your lab reports',
      description: 'Enter your mobile number. We will verify it before showing any patient or report information.',
      mobile: 'Mobile number',
      consent: <>I agree to receive a one-time verification code. Read our <a href="/privacy">privacy notice</a>.</>,
      send: 'Send code',
      sending: 'Sending code…',
      languages: 'Language',
      footer: 'Staff login',
    },
    te: {
      eyebrow: 'సురక్షిత రోగి ప్రవేశం',
      title: 'మీ ల్యాబ్ నివేదికలను చూడండి',
      description: 'మీ మొబైల్ నంబర్ నమోదు చేయండి. రోగి లేదా నివేదిక వివరాలను చూపించే ముందు దాన్ని ధృవీకరిస్తాము.',
      mobile: 'మొబైల్ నంబర్',
      consent: <>ఒకసారి మాత్రమే ఉపయోగించే ధృవీకరణ కోడ్‌ను స్వీకరించడానికి అంగీకరిస్తున్నాను. మా <a href="/privacy">గోప్యతా ప్రకటన</a> చదవండి.</>,
      send: 'కోడ్ పంపండి',
      sending: 'కోడ్ పంపుతోంది…',
      languages: 'భాష',
      footer: 'సిబ్బంది లాగిన్',
    },
    hi: {
      eyebrow: 'सुरक्षित रोगी प्रवेश',
      title: 'अपनी लैब रिपोर्ट देखें',
      description: 'अपना मोबाइल नंबर दर्ज करें। रोगी या रिपोर्ट की जानकारी दिखाने से पहले हम इसकी पुष्टि करेंगे।',
      mobile: 'मोबाइल नंबर',
      consent: <>मैं एक बार इस्तेमाल होने वाला सत्यापन कोड पाने के लिए सहमत हूँ। हमारी <a href="/privacy">गोपनीयता सूचना</a> पढ़ें।</>,
      send: 'कोड भेजें',
      sending: 'कोड भेजा जा रहा है…',
      languages: 'भाषा',
      footer: 'स्टाफ लॉगिन',
    },
  }[language];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    request.mutate();
  }

  return <main className="patient-shell">
    <PatientHeader />
    <div className="patient-preferences">
      <div className="language-control" role="group" aria-label={copy.languages}>
        {(['en', 'te', 'hi'] as const).map((value) => <button key={value} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)}>{value.toUpperCase()}</button>)}
      </div>
      <ThemeSwitcher theme={theme} onChange={(value) => setTheme(value)} />
    </div>
    <Card className="patient-auth-card">
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1>{copy.title}</h1>
      <p>{copy.description}</p>
      <form className="patient-auth-form" onSubmit={submit}>
        <Input label={copy.mobile} name="mobile" type="tel" inputMode="tel" autoComplete="tel" required value={mobile} onChange={(event) => setMobile(event.target.value)} />
        <label className="consent-control"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>{copy.consent}</span></label>
        {request.error && <p className="field__error" role="alert">{request.error.message}{retryRemaining > 0 ? ` Try again in ${retryRemaining} seconds.` : ''}</p>}
        <Button type="submit" variant="primary" disabled={request.isPending || retryRemaining > 0}>{request.isPending ? copy.sending : retryRemaining > 0 ? `Try again in ${retryRemaining}s` : copy.send}</Button>
      </form>
    </Card>
    <footer className="patient-footer"><a href="/staff">{copy.footer}</a></footer>
  </main>;
}

export function PrivacyNoticePage() {
  const { language } = useTheme();
  const copy = {
    en: ['Privacy notice', 'We use your mobile number and consent to verify access and link only the patient records associated with that number. Reports are shown only after verification. Access to report details and PDF downloads is recorded for security. Contact the lab to request help with your information or withdraw consent.'],
    te: ['గోప్యతా ప్రకటన', 'ప్రవేశాన్ని ధృవీకరించడానికి మరియు ఈ నంబర్‌కు సంబంధించిన రోగి రికార్డులను మాత్రమే అనుసంధానించడానికి మీ మొబైల్ నంబర్ మరియు సమ్మతిని ఉపయోగిస్తాము. ధృవీకరణ తర్వాత మాత్రమే నివేదికలు చూపబడతాయి. భద్రత కోసం నివేదిక వీక్షణలు మరియు PDF డౌన్‌లోడ్‌లు నమోదు చేయబడతాయి. మీ సమాచారం లేదా సమ్మతి ఉపసంహరణకు సహాయం కోసం ల్యాబ్‌ను సంప్రదించండి.'],
    hi: ['गोपनीयता सूचना', 'हम आपके मोबाइल नंबर और सहमति का उपयोग प्रवेश सत्यापित करने और केवल उस नंबर से जुड़े रोगी रिकॉर्ड जोड़ने के लिए करते हैं। रिपोर्ट सत्यापन के बाद ही दिखाई जाती हैं। सुरक्षा के लिए रिपोर्ट देखने और PDF डाउनलोड करने का रिकॉर्ड रखा जाता है। अपनी जानकारी या सहमति वापस लेने में सहायता के लिए लैब से संपर्क करें।'],
  }[language];
  return <main className="patient-shell"><PatientHeader /><Card><h1>{copy[0]}</h1><p>{copy[1]}</p><a href="/">Back to secure sign in</a></Card></main>;
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
      {demoMode && <p className="demo-otp-hint" role="status">Demo: code is in the outbox.</p>}
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
