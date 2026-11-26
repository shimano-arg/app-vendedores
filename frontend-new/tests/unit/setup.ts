import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Limpia el DOM entre tests para evitar leaks de assertions cross-file.
afterEach(() => {
  cleanup();
});
