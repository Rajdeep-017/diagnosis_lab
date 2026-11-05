import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Button, Card, EmptyState, ErrorState, Input, OtpInput, Select, Skeleton, StatusChip, Table, ThemeSwitcher, Toast, useToast } from './components/UI';
import { useTheme, type Language, type ThemeName } from './theme';

const StaffConsole = lazy(() => import('./pages/StaffConsole'));
const ReportPage = lazy(() => import('./pages/ReportPage'));
const ReportStyleguide = lazy(() => import('./pages/ReportStyleguide'));
const ReportLinkPage = lazy(() => import('./pages/PatientAccess').then((module) => ({ default: module.ReportLinkPage })));
const PatientLoginPage = lazy(() => import('./pages/PatientAccess').then((module) => ({ default: module.PatientLoginPage })));
const PatientVerifyPage = lazy(() => import('./pages/PatientAccess').then((module) => ({ default: module.PatientVerifyPage })));
const PatientPickerPage = lazy(() => import('./pages/PatientAccess').then((module) => ({ default: module.PatientPickerPage })));
const PatientOrdersPage = lazy(() => import('./pages/PatientAccess').then((module) => ({ default: module.PatientOrdersPage })));

type SampleCopy = { title: string; body: string; name: string };
const loadSampleCopy: Record<Language, () => Promise<SampleCopy>> = {
  en: () => import('./locales/en').then((module) => module.default),
  te: () => import('./locales/te').then((module) => module.default),
  hi: () => import('./locales/hi').then((module) => module.default),
};

function LanguageSample({ language }: { language: Language }) {
  const [copy, setCopy] = useState<SampleCopy>({ title: 'Loading preview…', body: 'Loading preview text.', name: 'Patient name' });
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let active = true;
    setLoadError(false);
    loadSampleCopy[language]().then((messages) => {
      if (active) setCopy(messages);
    }).catch((error: unknown) => {
      if (active) {
        console.error('Unable to load language preview', error);
        setLoadError(true);
      }
    });
    return () => { active = false; };
  }, [language]);
  return <div lang={language === 'te' ? 'te-IN' : language === 'hi' ? 'hi-IN' : 'en-IN'} className="language-sample">
    <h3>{loadError ? 'Preview language unavailable' : copy.title}</h3><p>{loadError ? 'Try refreshing this page to load the selected language.' : copy.body}</p><label>{copy.name}<input className="control" value="Anita Rao" readOnly /></label>
  </div>;
}

function ToastPreview() {
  const [visible, setVisible] = useState(true);
  return visible
    ? <Toast message="Report saved" onClose={() => setVisible(false)} />
    : <Button onClick={() => setVisible(true)}>Show toast preview</Button>;
}

function Styleguide() {
  const { theme, setTheme, language, setLanguage } = useTheme();
  const { showToast, toast } = useToast();
  const [notice, setNotice] = useState(false);
  const themes: ThemeName[] = ['clarity', 'large', 'night', 'console'];
  return <main className="styleguide-shell">
    <header className="styleguide-header"><a className="brand" href="/">Company A <span>Style guide</span></a><ThemeSwitcher theme={theme} onChange={(value) => setTheme(value)} /></header>
    <h1>Patient interface components</h1>
    <p className="lead">Design tokens and components for accessible lab reports. Select a language to preview translations.</p>
    <div className="language-control" role="group" aria-label="Preview language">
      {(['en', 'te', 'hi'] as const).map((value) => <button key={value} aria-pressed={language === value} onClick={() => setLanguage(value)}>{value.toUpperCase()}</button>)}
    </div>
    <div className="theme-gallery">
      {themes.map((value) => <section key={value} className="theme-example" data-theme={value}>
        <h2>{value[0].toUpperCase() + value.slice(1)} theme</h2>
        <ThemeSwitcher theme={value === 'console' ? 'clarity' : value} onChange={(next) => setTheme(next)} />
        <LanguageSample language={language} />
        <div className="component-row"><Button variant="primary">Primary action</Button><Button>Secondary</Button><StatusChip status="low">Below range</StatusChip></div>
        <Card><strong>Result card</strong><p>Haemoglobin · 10.2 g/dL</p><Skeleton className="skeleton--demo" /></Card>
        <div className="styleguide-fields"><Input label="Patient name" value="Anita Rao" readOnly /><OtpInput label="Verification code" placeholder="6-digit code" /><Select label="Choose a test"><option>Complete blood count</option></Select></div>
        <Table headers={['Test', 'Status']} rows={[[ 'Haemoglobin', <StatusChip status="low">Below range</StatusChip> ]]} />
        <ToastPreview />
        <div className="component-row"><Button onClick={() => showToast('Saved')}>Show toast</Button><Button onClick={() => setNotice(!notice)}>Toggle empty state</Button></div>
        {notice && <EmptyState title="No reports yet">When a report is ready, it will appear here.</EmptyState>}
        <ErrorState title="Could not load sample" onRetry={() => showToast('Retrying')} />
      </section>)}
    </div>
    {toast}
    <p><a href="/styleguide/report">Preview report fixtures and layouts</a></p>
  </main>;
}

function Landing() {
  const { theme, setTheme } = useTheme();
  return <main className="patient-shell">
    <header className="report-header"><a className="brand" href="/">Company A <span>Reports</span></a><ThemeSwitcher theme={theme} onChange={(value) => setTheme(value)} /></header>
    <section className="report-intro"><p className="eyebrow">Secure patient access</p><h1>Report delivery portal</h1><p className="lead">View your lab report and understand your results in the language you prefer.</p></section>
    <Card><h2>View your reports</h2><p>Verify your mobile number to see reports linked to your account.</p><Button variant="primary" onClick={() => { window.location.href = '/login'; }}>Patient sign in</Button></Card>
    <Card><h2>Staff access</h2><p>For lab staff managing report delivery.</p><Button onClick={() => { window.location.href = '/staff'; }}>Staff login</Button></Card>
  </main>;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => { window.location.replace(to); }, [to]);
  return <main className="patient-shell"><Skeleton className="skeleton--large" /></main>;
}

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="patient-shell"><Skeleton className="skeleton--large" /></main>}>{children}</Suspense>;
}

function RouteView() {
  const path = window.location.pathname;
  const reportLink = path.match(/^\/r\/([^/]+)$/);
  const reportMatch = path.match(/^\/report\/(\d+)$/);
  if (path === '/styleguide') return <Styleguide />;
  if (path === '/styleguide/report') return <LazyPage><ReportStyleguide /></LazyPage>;
  if (path === '/staff' || path === '/staff/login') return <LazyPage><StaffConsole /></LazyPage>;
  if (reportLink) return <LazyPage><ReportLinkPage token={decodeURIComponent(reportLink[1])} /></LazyPage>;
  if (path === '/login') return <LazyPage><PatientLoginPage /></LazyPage>;
  if (path === '/verify') return <LazyPage><PatientVerifyPage /></LazyPage>;
  if (path === '/patients') return <LazyPage><PatientPickerPage /></LazyPage>;
  if (path === '/orders') return <LazyPage><PatientOrdersPage /></LazyPage>;
  if (reportMatch) return <LazyPage><ReportPage orderId={Number(reportMatch[1])} /></LazyPage>;
  if (path === '/report') return <Redirect to="/login" />;
  return <Landing />;
}

export default function App() {
  return <RouteView />;
}
