import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest } from '../api';
import { Button, Card, Input, Skeleton, StatusChip, Table } from '../components/UI';

type StaffUser = { id: number; email: string; role: string };
type StaffOrder = { id: number; order: string; patient: string; status: string; last_delivery: string | null };
type StaffOrders = { orders: StaffOrder[] };
type ReviewSummary = { id: number; order: string; patient: string; parameter: string; language: string; text: string; flagged: boolean; reasons: string[] };
type StaffAccessLog = { id: number; actor: string; action: string; created_at: string };
type OutboxMessage = { id: number; order_id: number | null; order: string | null; to: string; body: string; status: string; created_at: string };
type CallbackTask = { id: number; order: string; patient: string; status: string; notes: string | null };

function StaffLogin() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const login = useMutation({
    mutationFn: () => apiRequest<{ user: StaffUser }>('/staff/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
    onSuccess: ({ user }) => {
      setErrorMessage('');
      queryClient.setQueryData(['staff', 'session'], { user });
    },
    onError: (error: Error) => setErrorMessage(error.message),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate();
  }

  return <main className="patient-shell staff-login-shell">
    <header className="report-header"><a className="brand" href="/">Company A <span>Staff</span></a></header>
    <Card className="staff-login-card">
      <p className="eyebrow">Staff access</p>
      <h1>Sign in</h1>
      <p className="lead">Use your staff account to access report orders.</p>
      <form className="staff-login-form" onSubmit={submit}>
        <Input label="Work email" name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <Input label="Password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        {errorMessage && <p className="field__error" role="alert">{errorMessage}</p>}
        <Button type="submit" variant="primary" disabled={login.isPending}>{login.isPending ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      {import.meta.env.VITE_DEMO_MODE === 'true' && <p className="login-help">Demo account: {import.meta.env.VITE_DEMO_STAFF_EMAIL || 'staff@example.com'} · {import.meta.env.VITE_DEMO_STAFF_PASSWORD || 'password123'}</p>}
    </Card>
  </main>;
}

function formatDelivery(value: string | null) {
  if (!value) return 'Not delivered';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function OrdersTable({ orders }: { orders: StaffOrder[] }) {
  const queryClient = useQueryClient();
  const [menuOrder, setMenuOrder] = useState<number | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<StaffOrder | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const accessLogs = useQuery({
    queryKey: ['staff', 'access-logs', selectedOrder?.id],
    queryFn: () => apiRequest<{ access_logs: StaffAccessLog[] }>(`/staff/orders/${selectedOrder!.id}/access-logs`),
    enabled: Boolean(selectedOrder),
  });
  const resend = useMutation({
    mutationFn: (id: number) => apiRequest<{ message: string }>(`/staff/orders/${id}/resend`, { method: 'POST' }),
    onSuccess: (result) => {
      setNotice(result.message);
      setActionError('');
      setMenuOrder(null);
    },
    onError: (error: Error) => setActionError(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['staff', 'orders'] }),
  });
  const rows = orders.map((order) => [
    <strong>{order.order}</strong>,
    order.patient,
    <StatusChip status={order.status === 'ready' ? 'delivered' : order.status}>{order.status === 'ready' ? 'Ready' : order.status}</StatusChip>,
    formatDelivery(order.last_delivery),
    <div className="table-action">
      <Button aria-expanded={menuOrder === order.id} aria-label={`Actions for ${order.order}`} onClick={() => setMenuOrder(menuOrder === order.id ? null : order.id)}>Actions</Button>
      {menuOrder === order.id && <div className="action-menu" role="menu">
        <button role="menuitem" onClick={() => { setSelectedOrder(order); setMenuOrder(null); }}>View order</button>
        <button role="menuitem" onClick={() => { setSelectedOrder(order); setMenuOrder(null); }}>View access log</button>
        <button role="menuitem" disabled={resend.isPending} onClick={() => resend.mutate(order.id)}>Queue delivery</button>
      </div>}
    </div>,
  ]);
  return <>
    {notice && <div className="staff-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}
    {actionError && <p className="field__error" role="alert">{actionError}</p>}
    {orders.length ? <Table headers={['Order', 'Patient', 'Status', 'Last delivery', 'Actions']} rows={rows} /> : <Card><h2>No orders found</h2><p>Orders will appear here when they are added to the database.</p></Card>}
    {selectedOrder && <div className="sheet-backdrop" role="presentation" onClick={() => setSelectedOrder(null)}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="order-detail-title" onClick={(event) => event.stopPropagation()}>
        <button className="sheet-close" aria-label="Close order details" onClick={() => setSelectedOrder(null)}>×</button>
        <p className="eyebrow">Order details</p><h2 id="order-detail-title">{selectedOrder.order}</h2>
        <p>Patient: {selectedOrder.patient}</p><p>Status: {selectedOrder.status}</p><p>Last delivery: {formatDelivery(selectedOrder.last_delivery)}</p>
        <h3>Access log</h3>
        {accessLogs.isPending && <Skeleton />}
        {accessLogs.isError && <p role="alert">{accessLogs.error.message}</p>}
        {accessLogs.data && accessLogs.data.access_logs.length > 0
          ? <Table headers={['Actor', 'Action', 'Time']} rows={accessLogs.data.access_logs.map((entry) => [entry.actor, entry.action, formatDelivery(entry.created_at)])} />
          : accessLogs.data && <p>No access events recorded.</p>}
      </section>
    </div>}
  </>;
}

function CsvImport() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const importCsv = useMutation({
    mutationFn: async (csvFile: File) => {
      const csv = await csvFile.text();
      return apiRequest<{ message: string }>('/staff/import/csv', {
        method: 'POST',
        body: JSON.stringify({ csv }),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['staff', 'orders'] }),
        queryClient.invalidateQueries({ queryKey: ['staff', 'outbox'] }),
        queryClient.invalidateQueries({ queryKey: ['staff', 'callback-tasks'] }),
      ]);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file) importCsv.mutate(file);
  }
  return <Card className="staff-import">
    <h2>Import lab results</h2>
    <p>Upload a CSV with order_no, patient_name, mobile, parameter, value, unit, reference_range, flag, and status columns.</p>
    <form onSubmit={submit}>
      <label className="field"><span className="field__label">Orders CSV</span><input aria-label="Orders CSV" type="file" accept=".csv,text/csv" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      {importCsv.isError && <p role="alert" className="field__error">{importCsv.error.message}</p>}
      {importCsv.data && <p role="status">{importCsv.data.message}</p>}
      <Button type="submit" variant="primary" disabled={!file || importCsv.isPending}>{importCsv.isPending ? 'Importing…' : 'Import CSV'}</Button>
    </form>
  </Card>;
}

/** Staff-only screen loaded on demand, separate from the patient entry chunk. */
export default function StaffConsole() {
  const queryClient = useQueryClient();
  const [logoutError, setLogoutError] = useState('');
  const session = useQuery({
    queryKey: ['staff', 'session'],
    queryFn: () => apiRequest<{ user: StaffUser }>('/staff/me'),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const orders = useQuery({
    queryKey: ['staff', 'orders'],
    queryFn: () => apiRequest<StaffOrders>('/staff/orders'),
    enabled: Boolean(session.data),
  });
  const reviewQueue = useQuery({
    queryKey: ['staff', 'summary-review'],
    queryFn: () => apiRequest<{ summaries: ReviewSummary[] }>('/staff/summaries/review'),
    enabled: Boolean(session.data),
  });
  const outbox = useQuery({
    queryKey: ['staff', 'outbox'],
    queryFn: () => apiRequest<{ messages: OutboxMessage[] }>('/staff/outbox'),
    enabled: Boolean(session.data),
  });
  const callbackTasks = useQuery({
    queryKey: ['staff', 'callback-tasks'],
    queryFn: () => apiRequest<{ tasks: CallbackTask[] }>('/staff/callback-tasks'),
    enabled: Boolean(session.data),
  });
  const logout = useMutation({
    mutationFn: () => apiRequest<void>('/staff/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['staff'] });
      void queryClient.setQueryData(['staff', 'session'], null);
    },
    onError: (error: Error) => setLogoutError(error.message),
  });

  if (session.isPending) return <main className="patient-shell"><Skeleton className="skeleton--large" /></main>;
  if (session.isError && session.error instanceof ApiError && session.error.status === 401) return <StaffLogin />;
  if (session.isError) return <main className="patient-shell"><Card><h1>Could not reach staff services</h1><p>{session.error.message}</p><Button onClick={() => void session.refetch()}>Try again</Button></Card></main>;
  if (!session.data) return <StaffLogin />;

  return <main className="staff-shell">
    <header className="staff-header"><a className="brand" href="/">Company A <span>Staff</span></a><nav aria-label="Staff navigation"><a href="#orders">Orders</a><a href="#delivery">Delivery</a><a href="#outbox">Outbox</a><a href="#callbacks">Callbacks</a><a href="#review">Pathologist review</a></nav><div className="staff-user"><span>{session.data.user.email}</span><Button disabled={logout.isPending} onClick={() => logout.mutate()}>{logout.isPending ? 'Signing out…' : 'Sign out'}</Button></div></header>
    <section className="staff-content" id="orders">
      {logoutError && <p className="field__error" role="alert">{logoutError}</p>}
      <p className="eyebrow">Operations</p><h1>Report orders</h1><p className="lead">Review delivery status and take action on an order.</p>
      <CsvImport />
      <div className="staff-stats"><div><span>Orders in database</span><strong>{orders.data?.orders.length ?? '—'}</strong></div><div><span>Ready for delivery</span><strong>{orders.data?.orders.filter((order) => order.status === 'ready').length ?? '—'}</strong></div><div><span>Account role</span><strong>{session.data.user.role.replace(/_/g, ' ')}</strong></div></div>
      <h2 id="delivery">Recent orders</h2>
      {orders.isPending && <Skeleton className="skeleton--large" />}
      {orders.isError && <Card><h2>Orders could not be loaded</h2><p>{orders.error.message}</p><Button onClick={() => void orders.refetch()}>Try again</Button></Card>}
      {orders.data && <OrdersTable orders={orders.data.orders} />}
      <section id="outbox">
        <h2>Message outbox</h2>
        {outbox.isPending && <Skeleton className="skeleton--large" />}
        {outbox.isError && <Card><h3>Outbox could not be loaded</h3><p>{outbox.error.message}</p><Button onClick={() => void outbox.refetch()}>Try again</Button></Card>}
        {outbox.data && outbox.data.messages.length > 0 && <Table headers={['Order', 'Recipient', 'Message', 'Status']} rows={outbox.data.messages.map((message) => {
          const link = message.body.match(/\/r\/[A-Za-z0-9_-]+/)?.[0];
          return [
            message.order ?? '—',
            message.to,
            <span>{message.body}{link && <> · <a href={link}>Open patient link</a></>}</span>,
            message.status,
          ];
        })} />}
        {outbox.data && outbox.data.messages.length === 0 && <Card><p>No messages in the outbox.</p></Card>}
      </section>
      <section id="callbacks">
        <h2>Patient callback tasks</h2>
        {callbackTasks.isPending && <Skeleton className="skeleton--large" />}
        {callbackTasks.isError && <Card><h3>Callback tasks could not be loaded</h3><p>{callbackTasks.error.message}</p><Button onClick={() => void callbackTasks.refetch()}>Try again</Button></Card>}
        {callbackTasks.data && callbackTasks.data.tasks.length > 0 && <Table headers={['Order', 'Patient', 'Status', 'Notes']} rows={callbackTasks.data.tasks.map((task) => [task.order, task.patient, task.status, task.notes ?? '—'])} />}
        {callbackTasks.data && callbackTasks.data.tasks.length === 0 && <Card><p>No open callback tasks.</p></Card>}
      </section>
      <section id="review" aria-labelledby="review-title">
        <h2 id="review-title">Pathologist review queue</h2>
        <p>Patient-reported summary issues appear first, with their feedback reason.</p>
        {reviewQueue.isPending && <Skeleton className="skeleton--large" />}
        {reviewQueue.isError && <Card><h3>Review queue could not be loaded</h3><p>{reviewQueue.error.message}</p><Button onClick={() => void reviewQueue.refetch()}>Try again</Button></Card>}
        {reviewQueue.data && reviewQueue.data.summaries.length > 0 && <Table
          headers={['Priority', 'Order', 'Patient', 'Parameter · language', 'Summary', 'Patient reason']}
          rows={reviewQueue.data.summaries.map((item) => [
            <StatusChip status={item.flagged ? 'high' : 'pending'}>{item.flagged ? 'Patient flagged' : 'Pending review'}</StatusChip>,
            item.order,
            item.patient,
            `${item.parameter} · ${item.language.toUpperCase()}`,
            item.text,
            item.reasons.length ? item.reasons.join('; ') : item.flagged ? 'No reason provided' : '—',
          ])}
        />}
        {reviewQueue.data && reviewQueue.data.summaries.length === 0 && <Card><h3>No summaries awaiting review</h3><p>New patient feedback will appear here.</p></Card>}
      </section>
    </section>
  </main>;
}
