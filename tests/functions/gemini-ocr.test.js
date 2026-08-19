import { describe, expect, it, vi } from 'vitest';
import { runGeminiOcr } from '../../functions/core/gemini-ocr-core.js';

/**
 * Helper: build deps con overrides. fetch mock devuelve una respuesta
 * OK con un candidato Gemini valido por default.
 */
function makeDeps(over = {}) {
  const defaultFetch = vi.fn(async () =>
    makeGeminiResponse({
      numeroTicket: 'A-0001-00042',
      descripcion: 'COMBUSTIBLE',
      modoPago: 'CORPORATIVA',
      moneda: 'PESOS',
      tipoGasto: 'FACTURA A',
      importe: 12500.5,
      importeUsd: null,
      divisionGasto: 'GASTO LOCAL',
      observaciones: 'YPF Ruta 3',
    })
  );
  return {
    fetch: defaultFetch,
    apiKey: 'AIzaSy-test-key',
    log: vi.fn(),
    ...over,
  };
}

function makeGeminiResponse(parsed) {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(parsed) }],
          },
        },
      ],
    }),
  };
}

const validInput = () => ({
  imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=',
  mimeType: 'image/png',
});

const validAuth = () => ({ uid: 'u1', email: 'mariano@shimano.com.ar' });

describe('runGeminiOcr — auth', () => {
  it('sin auth → unauthenticated', async () => {
    const deps = makeDeps();
    await expect(runGeminiOcr(deps, null, validInput())).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('auth sin email → unauthenticated', async () => {
    const deps = makeDeps();
    await expect(
      runGeminiOcr(deps, { uid: 'u1', email: '' }, validInput())
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('auth con email fuera de @shimano → permission-denied', async () => {
    const deps = makeDeps();
    await expect(
      runGeminiOcr(deps, { uid: 'u1', email: 'random@gmail.com' }, validInput())
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('@shimano.com.ar → OK', async () => {
    const deps = makeDeps();
    const res = await runGeminiOcr(
      deps,
      { uid: 'u1', email: 'mariano@shimano.com.ar' },
      validInput()
    );
    expect(res.descripcion).toBe('COMBUSTIBLE');
  });

  it('@shimano.uy → OK', async () => {
    const deps = makeDeps();
    const res = await runGeminiOcr(
      deps,
      { uid: 'u1', email: 'santi@shimano.uy' },
      validInput()
    );
    expect(res.importe).toBe(12500.5);
  });
});

describe('runGeminiOcr — config', () => {
  it('sin apiKey → failed-precondition', async () => {
    const deps = makeDeps({ apiKey: '' });
    await expect(runGeminiOcr(deps, validAuth(), validInput())).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe('runGeminiOcr — input validation', () => {
  it('sin imageBase64 → invalid-argument', async () => {
    const deps = makeDeps();
    await expect(
      runGeminiOcr(deps, validAuth(), { mimeType: 'image/png' })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('mimeType no soportado → invalid-argument', async () => {
    const deps = makeDeps();
    await expect(
      runGeminiOcr(deps, validAuth(), { imageBase64: 'aGVsbG8=', mimeType: 'video/mp4' })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('imageBase64 con data: prefix → invalid-argument', async () => {
    const deps = makeDeps();
    await expect(
      runGeminiOcr(deps, validAuth(), {
        imageBase64: 'data:image/png;base64,aGVsbG8=',
        mimeType: 'image/png',
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('imageBase64 con chars invalidos → invalid-argument', async () => {
    const deps = makeDeps();
    await expect(
      runGeminiOcr(deps, validAuth(), {
        imageBase64: 'hello world!@#',
        mimeType: 'image/png',
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('imageBase64 > 10 MB → invalid-argument', async () => {
    const deps = makeDeps();
    const bigB64 = 'A'.repeat(10 * 1024 * 1024 + 1);
    await expect(
      runGeminiOcr(deps, validAuth(), { imageBase64: bigB64, mimeType: 'image/png' })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('runGeminiOcr — Gemini API', () => {
  it('llama al endpoint correcto con la key + JSON body', async () => {
    const deps = makeDeps();
    await runGeminiOcr(deps, validAuth(), validInput());
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = deps.fetch.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('gemini-2.5-flash');
    expect(url).toContain('key=AIzaSy-test-key');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.contents[0].parts[0].text).toContain('Shimano Argentina');
    expect(body.contents[0].parts[1].inline_data.mime_type).toBe('image/png');
    expect(body.generationConfig.temperature).toBe(0.1);
  });

  it('response non-2xx → internal error con status', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => ({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      })),
    });
    await expect(runGeminiOcr(deps, validAuth(), validInput())).rejects.toMatchObject({
      code: 'internal',
      message: expect.stringContaining('429'),
    });
  });

  it('response sin candidates → internal', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ candidates: [] }),
      })),
    });
    await expect(runGeminiOcr(deps, validAuth(), validInput())).rejects.toMatchObject({
      code: 'internal',
      message: expect.stringContaining('candidatos'),
    });
  });

  it('candidate sin text → internal', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ candidates: [{ content: { parts: [{}] } }] }),
      })),
    });
    await expect(runGeminiOcr(deps, validAuth(), validInput())).rejects.toMatchObject({
      code: 'internal',
      message: expect.stringContaining('vacia'),
    });
  });

  it('JSON invalido en el text → internal', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'esto no es JSON' }] } }],
        }),
      })),
    });
    await expect(runGeminiOcr(deps, validAuth(), validInput())).rejects.toMatchObject({
      code: 'internal',
      message: expect.stringContaining('JSON invalido'),
    });
  });

  it('AbortError (timeout) → deadline-exceeded', async () => {
    const deps = makeDeps({
      timeoutMs: 10, // muy corto para que dispare
      fetch: vi.fn(
        (_url, opts) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          })
      ),
    });
    await expect(runGeminiOcr(deps, validAuth(), validInput())).rejects.toMatchObject({
      code: 'deadline-exceeded',
    });
  });

  it('fetch tira error random → internal wrapping', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });
    await expect(runGeminiOcr(deps, validAuth(), validInput())).rejects.toMatchObject({
      code: 'internal',
      message: expect.stringContaining('ECONNREFUSED'),
    });
  });
});

describe('runGeminiOcr — happy path returns parsed', () => {
  it('devuelve el JSON parseado tal cual', async () => {
    const expected = {
      numeroTicket: 'B-1234-00007',
      descripcion: 'COMIDA',
      modoPago: 'EFECTIVO',
      moneda: 'PESOS',
      tipoGasto: 'GASTO CON COMPROBANTE',
      importe: 3500.0,
      importeUsd: null,
      divisionGasto: 'GASTO LOCAL',
      observaciones: 'Almuerzo Rosario',
    };
    const deps = makeDeps({
      fetch: vi.fn(async () => makeGeminiResponse(expected)),
    });
    const res = await runGeminiOcr(deps, validAuth(), validInput());
    expect(res).toEqual(expected);
  });
});
