import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { Footer } from './components/site/Footer';
import { Header } from './components/site/Header';
import { ToastProvider } from './components/ui/Toast';
import { Spinner } from './components/ui/Feedback';
import { useSeo } from './hooks/useSeo';
import { HomePage } from './pages/HomePage';

const ProductPage = lazy(() => import('./pages/ProductPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) {
        requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function Seo() {
  const { pathname } = useLocation();
  useSeo(pathname.replace(/\/+$/, '') || '/');
  return null;
}

export function App() {
  return (
    <ToastProvider>
      <ScrollManager />
      <Seo />
      <Header />
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        <Suspense
          fallback={
            <div className="container" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
              <Spinner />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/products/:slug" element={<ProductPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </ToastProvider>
  );
}
