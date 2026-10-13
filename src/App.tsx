import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider } from './lib/toast';
import { GroupLayout, RedirectToLastGroup } from './lib/group';
import { isConfigured, keyIsUnsafe } from './lib/supabase';
import { AppShell } from './components/AppShell';
import { Loading } from './components/ui';
import { Login, ResetPassword } from './pages/Auth';
import { GroupsPage, JoinPage } from './pages/Groups';
import { FeedPage } from './pages/Feed';
import { CatalogPage } from './pages/Catalog';
import { ItemPage } from './pages/ItemDetail';
import { ReviewEditor } from './pages/ReviewEditor';
import { PlansPage } from './pages/Plans';
import { ListsPage, ListPage } from './pages/Lists';
import { CrewPage } from './pages/Crew';
import { ProfilePage } from './pages/Profile';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: true } },
});

function SetupNotice() {
  return (
    <main className="page narrow setup">
      <h1 className="display hero">Stakeout needs a backend</h1>
      {keyIsUnsafe ? (
        <p className="error" role="alert">
          The configured key is a privileged (service-role / secret) key. It must never be used in a browser app, so it has been
          ignored. Use the <strong>anon / publishable</strong> key from Supabase → Project Settings → API.
        </p>
      ) : (
        <p>
          Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code> (or to the repository
          variables for the GitHub Pages build), then reload. The README walks through creating the Supabase project and running the migrations.
        </p>
      )}
    </main>
  );
}

function RequireAuth() {
  const { loading, session, recovery } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading label="Signing you in" />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (recovery) return <ResetPassword />;
  return <Outlet />;
}

export function App() {
  if (!isConfigured || keyIsUnsafe) return <SetupNotice />;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <HashRouter>
            <div className="atmosphere" aria-hidden="true"><i className="rain" /><i className="grain" /></div>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<RequireAuth />}>
                <Route path="/" element={<RedirectToLastGroup />} />
                <Route path="/groups" element={<GroupsPage />} />
                <Route path="/join/:code" element={<JoinPage />} />
                <Route path="/g/:gid" element={<GroupLayout><AppShell /></GroupLayout>}>
                  <Route index element={<Navigate to="feed" replace />} />
                  <Route path="feed" element={<FeedPage />} />
                  <Route path="catalog" element={<CatalogPage />} />
                  <Route path="catalog/:itemId" element={<ItemPage />} />
                  <Route path="review/new" element={<ReviewEditor />} />
                  <Route path="review/:reviewId/edit" element={<ReviewEditor />} />
                  <Route path="plans" element={<PlansPage />} />
                  <Route path="lists" element={<ListsPage />} />
                  <Route path="lists/:listId" element={<ListPage />} />
                  <Route path="crew" element={<CrewPage />} />
                  <Route path="people/:userId" element={<ProfilePage />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </HashRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
