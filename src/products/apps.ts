import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ProductSlug } from './registry';

/** Each product app is code-split: its logic and UI load only on its page. */
export const PRODUCT_APPS: Partial<Record<ProductSlug, LazyExoticComponent<ComponentType>>> = {
  'lead-engine': lazy(() => import('./lead-engine/ui/LeadEngineApp')),
  support: lazy(() => import('./support/ui/SupportApp')),
  'content-os': lazy(() => import('./content-os/ui/ContentOsApp')),
  'docs-intelligence': lazy(() => import('./docs-intelligence/ui/DocsApp')),
  'catalog-studio': lazy(() => import('./catalog-studio/ui/CatalogApp')),
  'business-intelligence': lazy(() => import('./business-intelligence/ui/BiApp')),
};
