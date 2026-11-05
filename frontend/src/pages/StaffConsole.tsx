import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest } from '../api';
import { Button, Card, EmptyState, Input, Skeleton, StatusChip, Table, Toast } from '../components/UI';

type StaffUser = { id: number; email: string; role: string };
type StaffOrder = {
  id: number;
  order: string;
  patient: string;
  mobile: string;
  doctor: string | null;
  signed_at: string | null;
  status: string;
  delivery_state: string;
  delivery_at: string | null;
  link_expires_at: string | null;
};
type StaffOrders = {
  orders: StaffOrder[];
  pagination: { page: number; page_size: number; total: number; pages: number };
};
type ReviewSummary = { id: number; order: string; patient: string; parameter: string; language: string; text: string; flagged: boolean; reasons: string[] };
type StaffAccessLog = { id: number; actor: string; action: string; created_at: string };
type StaffOrderDetail = {
  order: string;
  patient: string;
  status: string;
  doctor: string | null;
  signed_at: string | null;
  link_expires_at: string | null;
  delivery_timeline: { status: string; created_at: string }[];
  callback_task: { id: number; status: string; notes: string | null } | null;
};
type OutboxMessage = {
  id: number;
  order_id: number | null;
  order: string | null;
  time: string;
  channel: string;
  recipient: string;
  purpose: 'otp' | 'report-link' | 'callback-notice';
  body: string;
  status: string;
};
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
      {import.meta.env.VITE_DEMO_MODE === 'true' && import.meta.env.VITE_DEMO_STAFF_EMAIL && import.meta.env.VITE_DEMO_STAFF_PASSWORD && (
        <p className="login-help">Demo account: {import.meta.env.VITE_DEMO_STAFF_EMAIL} · {import.meta.env.VITE_DEMO_STAFF_PASSWORD}</p>
      )}
    </Card>
  </main>;
}

function formatDelivery(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function OrdersWorkspace() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deliveryFilter, setDeliveryFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [menuOrder, setMenuOrder] = useState<number | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<StaffOrder | null>(null);
  const [revealedMobiles, setRevealedMobiles] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const query = new URLSearchParams({
    search,
    status: statusFilter,
    delivery_state: deliveryFilter,
    page: String(page),
    page_size: '20',
  });
  const orders = useQuery({
    queryKey: ['staff', 'orders', search, statusFilter, deliveryFilter, page],
    queryFn: () => apiRequest<StaffOrders>(`/staff/orders?${query.toString()}`),
    placeholderData: (previous) => previous,
  });
  const detail = useQuery({
    queryKey: ['staff', 'order-detail', selectedOrder?.id],
    queryFn: () => apiRequest<StaffOrderDetail>(`/staff/orders/${selectedOrder!.id}`),
    enabled: Boolean(selectedOrder),
  });
  const accessLogs = useQuery({
    queryKey: ['staff', 'access-logs', selectedOrder?.id],
    queryFn: () => apiRequest<{ access_logs: StaffAccessLog[] }>(`/staff/orders/${selectedOrder!.id}/access-logs`),
    enabled: Boolean(selectedOrder),
  });
  const reveal = useMutation({
    mutationFn: (id: number) => apiRequest<{ mobile: string }>(`/staff/orders/${id}/reveal-mobile`, { method: 'POST' }),
    onSuccess: ({ mobile }, id) => setRevealedMobiles((current) => ({ ...current, [id]: mobile })),
    onError: (error: Error) => setActionError(error.message),
  });
  const resend = useMutation({
    mutationFn: (id: number) => apiRequest<{ message: string }>(`/staff/orders/${id}/resend`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    }),
    onSuccess: (result) => {
      setNotice(result.message);
      setActionError('');
      setMenuOrder(null);
    },
    onError: (error: Error) => setActionError(error.message),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff', 'orders'] });
      void queryClient.invalidateQueries({ queryKey: ['staff', 'order-detail'] });
    },
  });
  const deliveryLabel: Record<string, string> = {
    not_sent: 'Not sent',
    queued: 'Queued',
    sent: 'Sent',
    delivered: 'Delivered',
    failed: 'Failed',
    link_opened: 'Link opened',
    expired: 'Expired',
  };
  const orderStatusLabel: Record<string, string> = { processing: 'Processing', ready: 'Ready' };
  const rows = (orders.data?.orders ?? []).map((order) => [
    <strong>{order.order}</strong>,
    <div className="staff-patient-cell"><span>{order.patient}</span><span>{revealedMobiles[order.id] ?? order.mobile}</span>
      {!revealedMobiles[order.id] && <Button className="staff-reveal" disabled={reveal.isPending} onClick={() => reveal.mutate(order.id)}>Reveal</Button>}
    </div>,
    order.doctor ?? '—',
    formatDelivery(order.signed_at),
    <StatusChip status={order.status}>{orderStatusLabel[order.status] ?? order.status}</StatusChip>,
    <div><StatusChip status={order.delivery_state}>{deliveryLabel[order.delivery_state] ?? order.delivery_state}</StatusChip><time className="delivery-time">{formatDelivery(order.delivery_at)}</time></div>,
    <div className="table-action">
      <Button aria-expanded={menuOrder === order.id} aria-label={`Actions for ${order.order}`} onClick={() => setMenuOrder(menuOrder === order.id ? null : order.id)}>Actions</Button>
      {menuOrder === order.id && <div className="action-menu" role="menu">
        <button role="menuitem" onClick={() => { setSelectedOrder(order); setMenuOrder(null); }}>View</button>
        <button role="menuitem" onClick={() => {
          setMenuOrder(null);
          if (window.confirm(`Resend the report link for ${order.order}?`)) resend.mutate(order.id);
        }}>Resend link</button>
        <button role="menuitem" onClick={() => { setSelectedOrder(order); setMenuOrder(null); }}>Access log</button>
      </div>}
    </div>,
  ]);
  const filterChanged = (setter: (value: string) => void) => (value: string) => { setter(value); setPage(1); };
  return <>
    {notice && <Toast message={notice} onClose={() => setNotice('')} />}
    {actionError && <p className="field__error" role="alert">{actionError}</p>}
    <div className="orders-toolbar">
      <Input label="Search name, order number, or mobile" name="order-search" type="search" value={search} onChange={(event) => filterChanged(setSearch)(event.target.value)} />
      <label className="field"><span className="field__label">Order status</span><select className="control" value={statusFilter} onChange={(event) => filterChanged(setStatusFilter)(event.target.value)}>
        <option value="all">All statuses</option><option value="processing">Processing</option><option value="ready">Ready</option>
      </select></label>
      <label className="field"><span className="field__label">Delivery state</span><select className="control" value={deliveryFilter} onChange={(event) => filterChanged(setDeliveryFilter)(event.target.value)}>
        <option value="all">All delivery states</option><option value="not_sent">Not sent</option><option value="queued">Queued</option><option value="sent">Sent</option><option value="delivered">Delivered</option><option value="failed">Failed</option><option value="link_opened">Link opened</option><option value="expired">Expired</option>
      </select></label>
    </div>
    {orders.isPending && <Skeleton className="skeleton--large" />}
    {orders.isError && <Card><h2>Orders could not be loaded</h2><p>{orders.error.message}</p><Button onClick={() => void orders.refetch()}>Try again</Button></Card>}
    {orders.data && orders.data.orders.length > 0 && <Table headers={['Order', 'Patient / mobile', 'Doctor', 'Signed time', 'Order status', 'Delivery status / time', 'Actions']} rows={rows} />}
    {orders.data && orders.data.orders.length === 0 && <EmptyState title="No results">Try a different search or remove one of the filters.</EmptyState>}
    {orders.data && orders.data.pagination.pages > 1 && <nav className="pagination" aria-label="Order result pages">
      <Button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
      <span>Page {orders.data.pagination.page} of {orders.data.pagination.pages} · {orders.data.pagination.total} orders</span>
      <Button disabled={page >= orders.data.pagination.pages} onClick={() => setPage((current) => current + 1)}>Next</Button>
    </nav>}
    {selectedOrder && <div className="sheet-backdrop" role="presentation" onClick={() => setSelectedOrder(null)}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="order-detail-title" onClick={(event) => event.stopPropagation()}>
        <button className="sheet-close" aria-label="Close order details" onClick={() => setSelectedOrder(null)}>×</button>
        <p className="eyebrow">Order details</p><h2 id="order-detail-title">{selectedOrder.order}</h2>
        {detail.isPending && <Skeleton />}
        {detail.isError && <p role="alert">{detail.error.message}</p>}
        {detail.data && <div className="order-detail-summary">
          <p>Patient: {detail.data.patient}</p><p>Doctor: {detail.data.doctor ?? '—'}</p><p>Order status: {detail.data.status}</p>
          <p>Signed: {formatDelivery(detail.data.signed_at)}</p><p>Link expiry: {formatDelivery(detail.data.link_expires_at)}</p>
          {detail.data.callback_task && <Card><h3>Callback task</h3><p>{detail.data.callback_task.notes ?? 'Follow-up required.'}</p><StatusChip status={detail.data.callback_task.status}>{detail.data.callback_task.status}</StatusChip></Card>}
          <h3>Delivery timeline</h3>
          {detail.data.delivery_timeline.length
            ? <ol>{detail.data.delivery_timeline.map((event, index) => <li key={`${event.created_at}-${index}`}><StatusChip status={event.status}>{deliveryLabel[event.status] ?? event.status}</StatusChip> · {formatDelivery(event.created_at)}</li>)}</ol>
            : <p>No report link has been sent.</p>}
        </div>}
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

function OutboxTable({ messages }: { messages: OutboxMessage[] }) {
  const [copyError, setCopyError] = useState('');

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyError('');
    } catch (error) {
      setCopyError(error instanceof Error ? `Could not copy to clipboard: ${error.message}` : 'Could not copy to clipboard.');
    }
  }

  return <>
    {copyError && <p role="alert" className="field__error">{copyError}</p>}
    <Table headers={['Time', 'Channel', 'Recipient', 'Purpose', 'Status', 'Message']} rows={messages.map((message) => {
      const code = message.purpose === 'otp' ? message.body.match(/\b\d{4,8}\b/)?.[0] : undefined;
      const link = message.body.match(/\/r\/[A-Za-z0-9_-]+/)?.[0];
      return [
        <time dateTime={message.time}>{new Date(message.time).toLocaleString()}</time>,
        message.channel,
        message.recipient,
        message.purpose,
        message.status,
        <div className="outbox-message">
          <span>{message.body}</span>
          <span className="outbox-copy-actions" aria-label="Copy message details">
            {code && <Button onClick={() => void copy(code)}>Copy code</Button>}
            {link && <Button onClick={() => void copy(new URL(link, window.location.origin).href)}>Copy link</Button>}
          </span>
        </div>,
      ];
    })} />
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
  const [menuOpen, setMenuOpen] = useState(false);
  const session = useQuery({
    queryKey: ['staff', 'session'],
    queryFn: () => apiRequest<{ user: StaffUser }>('/staff/me'),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const reviewQueue = useQuery({
    queryKey: ['staff', 'summary-review'],
    queryFn: () => apiRequest<{ summaries: ReviewSummary[] }>('/staff/summaries/review'),
    enabled: Boolean(session.data),
  });
  const outbox = useQuery({
    queryKey: ['staff', 'outbox'],
    queryFn: () => apiRequest<{ messages: OutboxMessage[] }>('/staff/outbox'),
    enabled: session.data?.user.role === 'front_desk' || session.data?.user.role === 'ops',
    refetchInterval: 5_000,
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
    <header className="staff-header">
      <a className="brand" href="/">Company A <span>Staff</span></a>
      <Button className="staff-menu-toggle" aria-expanded={menuOpen} aria-controls="staff-navigation" onClick={() => setMenuOpen((open) => !open)}>Menu</Button>
      <nav id="staff-navigation" aria-label="Staff navigation" data-open={menuOpen}>
        <a href="#orders" onClick={() => setMenuOpen(false)}>Orders</a>
        <a href="#delivery" onClick={() => setMenuOpen(false)}>Delivery</a>
        {(session.data.user.role === 'front_desk' || session.data.user.role === 'ops') && <a href="#outbox" onClick={() => setMenuOpen(false)}>Outbox</a>}
        <a href="#callbacks" onClick={() => setMenuOpen(false)}>Callbacks</a>
        <a href="#review" onClick={() => setMenuOpen(false)}>Pathologist review</a>
      </nav>
      <div className="staff-user">
        <span className="staff-email" title={session.data.user.email}>{session.data.user.email}</span>
        <span className="staff-role">{session.data.user.role.replace(/_/g, ' ')}</span>
        <Button disabled={logout.isPending} onClick={() => logout.mutate()}>{logout.isPending ? 'Signing out…' : 'Sign out'}</Button>
      </div>
    </header>
    <section className="staff-content" id="orders">
      {logoutError && <p className="field__error" role="alert">{logoutError}</p>}
      <p className="eyebrow">Operations</p><h1>Report orders</h1><p className="lead">Review delivery status and take action on an order.</p>
      <h2 id="delivery">Orders</h2>
      <OrdersWorkspace />
      <section id="import-orders"><h2>Import lab results</h2><CsvImport /></section>
      {(session.data.user.role === 'front_desk' || session.data.user.role === 'ops') && <section id="outbox">
        <h2>Message outbox</h2>
        {outbox.isPending && <div role="status" aria-label="Loading outbox messages"><Skeleton className="skeleton--large" /></div>}
        {outbox.isError && <Card><h3>Outbox could not be loaded</h3><p>{outbox.error.message}</p><Button onClick={() => void outbox.refetch()}>Try again</Button></Card>}
        {outbox.data && outbox.data.messages.length > 0 && <OutboxTable messages={outbox.data.messages} />}
        {outbox.data && outbox.data.messages.length === 0 && <Card><p>No messages in the outbox.</p></Card>}
      </section>}
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
