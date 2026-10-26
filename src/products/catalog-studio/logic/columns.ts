import { detectColumns } from '../../../lib/columns';
import type { CatalogField } from './types';

export const CATALOG_SYNONYMS: Record<CatalogField, readonly string[]> = {
  sku: ['sku', 'артикул', 'код товара', 'код', 'article', 'vendor code', 'id товара', 'арт'],
  name: ['name', 'title', 'product name', 'наименование', 'название', 'товар', 'название товара'],
  brand: ['brand', 'vendor', 'manufacturer', 'бренд', 'производитель', 'марка', 'торговая марка'],
  category: ['category', 'категория', 'раздел', 'группа', 'тип товара'],
  price: ['price', 'цена', 'стоимость', 'цена продажи', 'розничная цена', 'цена руб'],
  oldPrice: ['old price', 'compare at price', 'старая цена', 'цена до скидки', 'зачеркнутая цена', 'цена без скидки'],
  stock: ['stock', 'quantity', 'qty', 'остаток', 'количество', 'наличие', 'остатки'],
  barcode: ['barcode', 'ean', 'ean13', 'gtin', 'штрихкод', 'штрих код', 'баркод'],
  weight: ['weight', 'вес', 'вес кг', 'масса'],
  description: ['description', 'описание', 'описание товара', 'аннотация'],
  seoTitle: ['seo title', 'meta title', 'seo заголовок', 'title tag', 'мета заголовок'],
};

export function detectCatalogColumns(headers: string[]): Record<CatalogField, string> {
  return detectColumns(headers, CATALOG_SYNONYMS);
}
