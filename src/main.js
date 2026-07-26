// @ts-check
/**
 * Entrypoint del bundle Fase 0 (E2). Reúne los módulos ya extraídos y los
 * expone en window.__phase0 como capa aditiva NO-BREAKING: index.html sigue
 * usando sus propias copias inline hasta que E2.b haga la migración real.
 *
 * Contrato: cualquier función expuesta acá debe ser semánticamente idéntica
 * a la versión inline en index.html (verificada por los tests de tests/unit/).
 */

import {
  normClientName,
  titleCase,
  escapeHtml,
  normTitle,
  normalizeSearch,
} from './pure/normalize.js';
import { calcClientDiscount } from './pure/discount.js';
import { matchesAllTokens } from './pure/search.js';
import { findSapDuplicateForProvisorio } from './pure/duplicate.js';
import { matchSkuFromTitle } from './pure/product-match.js';
import { passesTypeFilter } from './pure/filters.js';
import { applySentryUserContext } from './sentry.js';
import { createSapClient } from './sap-client.js';

const phase0 = {
  version: 'v325',
  pure: {
    normClientName,
    titleCase,
    escapeHtml,
    normTitle,
    normalizeSearch,
    calcClientDiscount,
    matchesAllTokens,
    findSapDuplicateForProvisorio,
    matchSkuFromTitle,
    passesTypeFilter,
  },
  sentry: { applySentryUserContext },
  sap: { createSapClient },
};

// @ts-ignore — window augmentation runtime-only
if (typeof window !== 'undefined') window.__phase0 = phase0;

export default phase0;
